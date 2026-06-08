import Client from "../models/client.models.js";
import Organization from "../models/organization.models.js";
import User from "../models/users.models.js";
import { buildOrgAccess } from "./orgRoles.js";

/** Collect account client + all descendant client IDs (BFS). */
export const collectClientScope = async (orgId, accountClientId) => {
  const scope = new Set([accountClientId.toString()]);
  let frontier = [accountClientId.toString()];

  while (frontier.length) {
    const children = await Client.find({
      organization_id: orgId,
      parent_client_id: { $in: frontier },
    }).select("_id");

    const next = [];
    for (const c of children) {
      const id = c._id.toString();
      if (!scope.has(id)) {
        scope.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }

  return [...scope];
};

export const collectClientScopeForAccounts = async (orgId, accountClientIds) => {
  const scope = new Set();
  for (const accountId of accountClientIds) {
    const ids = await collectClientScope(orgId, accountId);
    ids.forEach((id) => scope.add(id));
  }
  return [...scope];
};

import {
  memberUserId,
  getMemberClientAccountIds,
  memberHasClientAccount,
} from "./clientPortalMember.js";

export { getMemberClientAccountIds, memberHasClientAccount, memberUserId } from "./clientPortalMember.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findBillingClientsByEmail = async (orgId, email) => {
  const normalized = email?.trim();
  if (!normalized) return [];
  return Client.find({
    organization_id: orgId,
    parent_client_id: null,
    email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, "i") },
  });
};

/** @deprecated use findBillingClientsByEmail */
export const findBillingClientByEmail = async (orgId, email) => {
  const clients = await findBillingClientsByEmail(orgId, email);
  return clients[0] || null;
};

/** Upsert org membership — adds billing account without replacing existing ones. */
export const grantClientPortalAccess = async (org, userId, clientAccountId) => {
  if (!org || !userId || !clientAccountId) return org;
  if (org.owner_id?.toString() === userId.toString()) return org;

  const uid = userId.toString();
  const accountId = clientAccountId.toString();
  const existing = org.members?.find((m) => memberUserId(m) === uid);

  if (existing) {
    existing.role = "client";
    existing.status = "active";
    const ids = getMemberClientAccountIds(existing);
    if (!ids.includes(accountId)) {
      existing.client_account_ids = [...ids, accountId];
    } else {
      existing.client_account_ids = ids;
    }
    existing.client_account_id = existing.client_account_ids[0] || null;
  } else {
    org.members.push({
      user: userId,
      role: "client",
      status: "active",
      client_account_id: clientAccountId,
      client_account_ids: [clientAccountId],
    });
  }

  await org.save();
  return org;
};

export const revokeClientPortalAccess = async (org, userId, clientAccountId) => {
  if (!org || !userId || !clientAccountId) return org;

  const uid = userId.toString();
  const accountId = clientAccountId.toString();
  const member = org.members?.find((m) => memberUserId(m) === uid);
  if (!member) return org;

  const remaining = getMemberClientAccountIds(member).filter((id) => id !== accountId);
  member.client_account_ids = remaining;
  member.client_account_id = remaining[0] || null;

  if (remaining.length === 0) {
    member.role = "viewer";
  }

  await org.save();
  return org;
};

export const getClientPortalAccess = (org, userId) => {
  if (!org || !userId) return null;
  const uid = userId.toString();
  const member = org.members?.find(
    (m) => memberUserId(m) === uid && m.status === "active" && m.role === "client"
  );
  const accountIds = getMemberClientAccountIds(member);
  if (!accountIds.length) return null;
  return {
    accountIds,
    clientAccountId: accountIds[0],
    member,
  };
};

/** @deprecated use getClientPortalAccess */
export const getClientPortalMembership = (org, userId) => {
  const access = getClientPortalAccess(org, userId);
  if (!access) return null;
  return {
    clientAccountId: access.clientAccountId,
    member: access.member,
  };
};

export const resolveClientPortalAccess = async (org, userId, userEmail, { sync = false } = {}) => {
  let access = getClientPortalAccess(org, userId);

  const email = userEmail?.trim();
  if (email && org?._id && org.owner_id?.toString() !== userId?.toString()) {
    const billingClients = await findBillingClientsByEmail(org._id, email);
    if (billingClients.length) {
      if (sync) {
        for (const client of billingClients) {
          await grantClientPortalAccess(org, userId, client._id);
        }
        const refreshed = await Organization.findById(org._id);
        access = getClientPortalAccess(refreshed, userId);
        return access;
      }
      if (!access) {
        return {
          accountIds: billingClients.map((c) => c._id.toString()),
          clientAccountId: billingClients[0]._id.toString(),
          member: null,
          viaEmail: true,
        };
      }
    }
  }

  return access;
};

/** @deprecated use resolveClientPortalAccess */
export const resolveClientPortalMembership = resolveClientPortalAccess;

export const syncPortalAccessForClientRecord = async (client) => {
  if (!client?.email?.trim() || client.parent_client_id) return null;

  const user = await User.findOne({ email: client.email.trim().toLowerCase() });
  if (!user) return null;

  const org = await Organization.findById(client.organization_id);
  if (!org || org.owner_id.toString() === user._id.toString()) return null;

  await grantClientPortalAccess(org, user._id, client._id);
  return user;
};

export const findPortalOrgsForUser = async (user) => {
  const userId = user._id;
  const email = user.email?.trim();

  const memberOrgs = await Organization.find({ "members.user": userId }).select(
    "name description owner_id members"
  );

  const orgIds = new Set(memberOrgs.map((o) => o._id.toString()));
  let emailOrgs = [];

  if (email) {
    const billingClients = await Client.find({
      email: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") },
      parent_client_id: null,
    }).select("organization_id");

    const missingOrgIds = [
      ...new Set(
        billingClients
          .map((c) => c.organization_id?.toString())
          .filter((id) => id && !orgIds.has(id))
      ),
    ];

    if (missingOrgIds.length) {
      emailOrgs = await Organization.find({ _id: { $in: missingOrgIds } }).select(
        "name description owner_id members"
      );
    }
  }

  return [...memberOrgs, ...emailOrgs.filter((o) => !orgIds.has(o._id.toString()))];
};

export const getClientScopeIdsForUser = async (orgId, org, userId, userEmail, { sync = false } = {}) => {
  const access = await resolveClientPortalAccess(org, userId, userEmail, { sync });
  if (!access?.accountIds?.length) return null;
  return collectClientScopeForAccounts(orgId, access.accountIds);
};

export const filterProjectsForClientScope = (projects, clientScopeIds) => {
  if (!clientScopeIds?.length) return [];
  const scope = new Set(clientScopeIds.map(String));
  return projects.filter((p) => p.client_id && scope.has(p.client_id.toString()));
};

export const getClientPortalContext = async (orgId, userId, userEmail) => {
  const org = await Organization.findById(orgId);
  if (!org) {
    const err = new Error("Organization not found");
    err.status = 404;
    throw err;
  }

  const email =
    userEmail ||
    (await User.findById(userId).select("email"))?.email ||
    "";

  const portal = await resolveClientPortalAccess(org, userId, email, { sync: true });
  if (!portal) {
    const err = new Error("You do not have client portal access to this organization");
    err.status = 403;
    throw err;
  }

  const clientScopeIds = await collectClientScopeForAccounts(orgId, portal.accountIds);
  const accountClients = await Client.find({
    _id: { $in: portal.accountIds },
    organization_id: orgId,
  }).select("name company email");

  return {
    org,
    access: {
      ...buildOrgAccess(org, userId),
      role: "client",
      isClientPortal: true,
      canWrite: false,
      canAccessFinance: false,
      canManageMembers: false,
      canSeeExactAmounts: true,
      clientAccountId: portal.clientAccountId,
      clientAccountIds: portal.accountIds,
      clientScopeIds,
    },
    accountClients,
    accountClient: accountClients[0] || null,
    clientScopeIds,
  };
};

export const assertClientCanAccessProject = async (orgId, userId, project, userEmail) => {
  const ctx = await getClientPortalContext(orgId, userId, userEmail);
  const clientId = project.client_id?.toString();
  if (!clientId || !ctx.clientScopeIds.includes(clientId)) {
    const err = new Error("You do not have access to this project");
    err.status = 403;
    throw err;
  }
  return ctx;
};
