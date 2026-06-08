import Client from "../models/client.models.js";
import Project from "../models/project.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import Organization from "../models/organization.models.js";
import User from "../models/users.models.js";
import { getOrgForMember, assertCanWriteOrg, assertCanManageOrgMembers } from "../utils/orgAccess.js";
import {
  collectClientScope,
  grantClientPortalAccess,
  getClientPortalAccess,
  getMemberClientAccountIds,
  memberHasClientAccount,
  revokeClientPortalAccess,
  syncPortalAccessForClientRecord,
} from "../utils/clientPortal.js";
import { normalizeFinanceCurrency } from "../constants/financeCurrencies.js";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  CLIENT_PRIORITIES,
  LOG_TYPES,
} from "../constants/crmClient.js";
import {
  buildCrmOverview,
  buildCrmDashboard,
  enrichClientListItem,
  buildClientDetailSummary,
} from "../utils/crmMetrics.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const parseTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

const assertValidParentClient = async (orgId, clientId, parentId) => {
  if (!parentId) return null;
  if (parentId.toString() === clientId?.toString()) {
    const err = new Error("A client cannot be its own billing account");
    err.status = 400;
    throw err;
  }
  const parent = await Client.findOne({ _id: parentId, organization_id: orgId });
  if (!parent) {
    const err = new Error("Billing account client not found");
    err.status = 404;
    throw err;
  }
  let cursor = parent;
  const seen = new Set([clientId?.toString()].filter(Boolean));
  while (cursor?.parent_client_id) {
    const pid = cursor.parent_client_id.toString();
    if (seen.has(pid)) {
      const err = new Error("Invalid billing account hierarchy");
      err.status = 400;
      throw err;
    }
    seen.add(pid);
    if (pid === clientId?.toString()) {
      const err = new Error("Circular billing account link");
      err.status = 400;
      throw err;
    }
    cursor = await Client.findOne({ _id: pid, organization_id: orgId });
  }
  return parent;
};

const applyClientFields = async (client, body, orgId) => {
  if (body.name?.trim()) client.name = body.name.trim();
  if (typeof body.email === "string") client.email = body.email.trim();
  if (typeof body.phone === "string") client.phone = body.phone.trim();
  if (typeof body.company === "string") client.company = body.company.trim();
  if (typeof body.website === "string") client.website = body.website.trim();
  if (typeof body.notes === "string") client.notes = body.notes.trim();
  if (typeof body.referral_source === "string") client.referral_source = body.referral_source.trim();
  if (CLIENT_STATUSES.includes(body.status)) client.status = body.status;
  if (CLIENT_TYPES.includes(body.client_type)) client.client_type = body.client_type;
  if (CLIENT_PRIORITIES.includes(body.priority)) client.priority = body.priority;
  if (body.currency !== undefined) client.currency = normalizeFinanceCurrency(body.currency, "BDT");
  if (body.hourly_rate !== undefined && body.hourly_rate !== "") {
    client.hourly_rate = body.hourly_rate == null ? null : Math.max(0, Number(body.hourly_rate));
  }
  if (body.expected_value !== undefined && body.expected_value !== "") {
    client.expected_value = body.expected_value == null ? null : Math.max(0, Number(body.expected_value));
  }
  if (body.next_follow_up !== undefined) {
    client.next_follow_up = body.next_follow_up ? new Date(body.next_follow_up) : null;
  }
  if (body.tags !== undefined) client.tags = parseTags(body.tags);
  if (body.parent_client_id !== undefined) {
    const parentRaw = body.parent_client_id || null;
    if (!parentRaw) {
      client.parent_client_id = null;
    } else {
      await assertValidParentClient(orgId, client._id, parentRaw);
      client.parent_client_id = parentRaw;
    }
  }
};

export const crmDashboard = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await getOrgForMember(orgId, req.user._id);
    const dashboard = await buildCrmDashboard(orgId);
    return res.status(200).json({
      message: "CRM dashboard retrieved",
      success: true,
      dashboard: { ...dashboard, access },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const crmOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await getOrgForMember(orgId, req.user._id);
    const overview = await buildCrmOverview(orgId);
    return res.status(200).json({
      message: "CRM overview retrieved",
      success: true,
      overview: {
        access,
        totalClients: overview.totalClients,
        leads: overview.leads,
        activeClients: (overview.byStatus.active || 0) + (overview.byStatus.negotiation || 0),
        onHold: overview.byStatus.on_hold || 0,
        pastClients: overview.byStatus.past || 0,
        followUpsDue: overview.followUpsDue,
        totalRevenue: overview.totalRevenue,
        pipelineValue: overview.pipelineValue,
        byStatus: overview.byStatus,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientList = async (req, res) => {
  const { orgId } = req.params;
  const { status, follow_up } = req.query;

  try {
    await getOrgForMember(orgId, req.user._id);
    const filter = { organization_id: orgId };
    if (status && CLIENT_STATUSES.includes(status)) filter.status = status;

    let clients = await Client.find(filter).sort({ updatedAt: -1 });
    const overview = await buildCrmOverview(orgId);

    const childCountByParent = {};
    for (const c of clients) {
      if (c.parent_client_id) {
        const pid = c.parent_client_id.toString();
        childCountByParent[pid] = (childCountByParent[pid] || 0) + 1;
      }
    }

    let enriched = clients.map((c) => {
      const item = enrichClientListItem(c, overview);
      return {
        ...item,
        child_count: childCountByParent[c._id.toString()] || 0,
        is_billing_account: !c.parent_client_id,
      };
    });

    if (follow_up === "due") {
      enriched = enriched.filter((c) => c.followUpDue);
    }

    enriched.sort((a, b) => {
      if (a.followUpDue !== b.followUpDue) return a.followUpDue ? -1 : 1;
      if (a.priority === "high" && b.priority !== "high") return -1;
      if (b.priority === "high" && a.priority !== "high") return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    return res.status(200).json({
      message: "Clients retrieved",
      success: true,
      clients: enriched,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Client name is required", success: false });
  }

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const client = new Client({
      organization_id: orgId,
      name: name.trim(),
      email: (req.body.email || "").trim(),
      phone: (req.body.phone || "").trim(),
      company: (req.body.company || "").trim(),
      website: (req.body.website || "").trim(),
      notes: (req.body.notes || "").trim(),
      status: CLIENT_STATUSES.includes(req.body.status) ? req.body.status : "lead",
      client_type: CLIENT_TYPES.includes(req.body.client_type) ? req.body.client_type : "prospect",
      priority: CLIENT_PRIORITIES.includes(req.body.priority) ? req.body.priority : "normal",
      currency: normalizeFinanceCurrency(req.body.currency, "BDT"),
      hourly_rate:
        req.body.hourly_rate != null && req.body.hourly_rate !== ""
          ? Math.max(0, Number(req.body.hourly_rate))
          : null,
      expected_value:
        req.body.expected_value != null && req.body.expected_value !== ""
          ? Math.max(0, Number(req.body.expected_value))
          : null,
      referral_source: (req.body.referral_source || "").trim(),
      tags: parseTags(req.body.tags),
      next_follow_up: req.body.next_follow_up ? new Date(req.body.next_follow_up) : null,
      parent_client_id: null,
    });
    if (req.body.parent_client_id) {
      await assertValidParentClient(orgId, client._id, req.body.parent_client_id);
      client.parent_client_id = req.body.parent_client_id;
    }
    await client.save();
    await syncPortalAccessForClientRecord(client);

    const overview = await buildCrmOverview(orgId);
    const enriched = enrichClientListItem(client, overview);

    return res.status(201).json({ message: "Client created", success: true, client: enriched });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientGet = async (req, res) => {
  const { orgId, clientId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    const scopeIds = await collectClientScope(orgId, clientId);
    const [projects, incomes, childClients, parentClient] = await Promise.all([
      Project.find({ organization_id: orgId, client_id: { $in: scopeIds } }).sort({ createdAt: -1 }),
      IncomeTransaction.find({ organization_id: orgId, client_id: { $in: scopeIds } })
        .sort({ payment_date: -1 })
        .limit(100)
        .select("amount category payment_date payment_method notes project_id client_id")
        .populate("client_id", "name company"),
      Client.find({ organization_id: orgId, parent_client_id: clientId }).select(
        "name company status email"
      ),
      client.parent_client_id
        ? Client.findById(client.parent_client_id).select("name company email")
        : null,
    ]);

    const org = await Organization.findById(orgId).populate("members.user", "email fullName");
    const portalMembers = (org?.members || [])
      .filter(
        (m) =>
          m.role === "client" &&
          memberHasClientAccount(m, clientId) &&
          m.status === "active"
      )
      .map((m) => ({
        user_id: m.user?._id || m.user,
        email: m.user?.email,
        fullName: m.user?.fullName,
      }));

    const summary = buildClientDetailSummary(client, projects, incomes);

    return res.status(200).json({
      message: "Client details retrieved",
      success: true,
      client,
      parent_client: parentClient,
      child_clients: childClients,
      portal_members: portalMembers,
      projects,
      incomes,
      summary,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientUpdate = async (req, res) => {
  const { orgId, clientId } = req.params;

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    await applyClientFields(client, req.body, orgId);
    await client.save();
    await syncPortalAccessForClientRecord(client);

    const overview = await buildCrmOverview(orgId);
    const enriched = enrichClientListItem(client, overview);

    return res.status(200).json({ message: "Client updated", success: true, client: enriched });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDelete = async (req, res) => {
  const { orgId, clientId } = req.params;
  try {
    await assertCanManageOrgMembers(orgId, req.user._id);
    const client = await Client.findOneAndDelete({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }
    await Project.updateMany({ client_id: clientId }, { $set: { client_id: null } });
    await Client.updateMany({ parent_client_id: clientId }, { $set: { parent_client_id: null } });

    const orgsWithPortal = await Organization.find({
      $or: [
        { "members.client_account_id": clientId },
        { "members.client_account_ids": clientId },
      ],
    });
    for (const org of orgsWithPortal) {
      for (const m of org.members) {
        if (m.role !== "client") continue;
        const ids = getMemberClientAccountIds(m).filter((id) => id !== clientId.toString());
        m.client_account_ids = ids;
        m.client_account_id = ids[0] || null;
        if (ids.length === 0) m.role = "viewer";
      }
      await org.save();
    }
    return res.status(200).json({ message: "Client deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientAddLog = async (req, res) => {
  const { orgId, clientId } = req.params;
  const { note, type } = req.body;

  if (!note?.trim()) {
    return res.status(400).json({ message: "Note is required", success: false });
  }

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    const logType = LOG_TYPES.includes(type) ? type : "note";
    const now = new Date();
    client.communicationLogs.unshift({ note: note.trim(), type: logType, loggedAt: now });
    client.last_contacted_at = now;
    await client.save();

    return res.status(201).json({ message: "Activity logged", success: true, client });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDeleteLog = async (req, res) => {
  const { orgId, clientId, logId } = req.params;

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    const before = client.communicationLogs.length;
    client.communicationLogs = client.communicationLogs.filter(
      (log) => log._id.toString() !== logId
    );
    if (client.communicationLogs.length === before) {
      return res.status(404).json({ message: "Log not found", success: false });
    }

    const latest = client.communicationLogs[0];
    client.last_contacted_at = latest?.loggedAt || null;
    await client.save();

    return res.status(200).json({ message: "Activity removed", success: true, client });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientPortalInvite = async (req, res) => {
  const { orgId, clientId } = req.params;
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({ message: "Email is required", success: false });
  }

  try {
    const { org } = await assertCanManageOrgMembers(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }
    if (client.parent_client_id) {
      return res.status(400).json({
        message: "Portal access is set on the billing account client, not sub-clients",
        success: false,
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(400).json({
        message: "No user with that email. Ask them to register first, then invite again.",
        success: false,
      });
    }

    if (org.owner_id.toString() === user._id.toString()) {
      return res.status(400).json({ message: "Owner cannot be a portal client", success: false });
    }

    const existing = getClientPortalAccess(org, user._id);
    if (existing?.accountIds.includes(clientId)) {
      return res.status(400).json({ message: "User already has portal access", success: false });
    }

    await grantClientPortalAccess(org, user._id, client._id);

    return res.status(200).json({
      success: true,
      message: "Client portal access granted",
      email: user.email,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientPortalRevoke = async (req, res) => {
  const { orgId, clientId, userId } = req.params;
  try {
    const { org } = await assertCanManageOrgMembers(orgId, req.user._id);
    await revokeClientPortalAccess(org, userId, clientId);
    return res.status(200).json({ success: true, message: "Portal access removed" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientSnoozeFollowUp = async (req, res) => {
  const { orgId, clientId } = req.params;
  const { days } = req.body;
  const addDays = Math.max(1, Math.min(90, Number(days) || 7));

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const client = await Client.findOne({ _id: clientId, organization_id: orgId });
    if (!client) {
      return res.status(404).json({ message: "Client not found", success: false });
    }

    const next = new Date();
    next.setDate(next.getDate() + addDays);
    client.next_follow_up = next;
    await client.save();

    return res.status(200).json({
      message: `Follow-up set to ${next.toISOString().slice(0, 10)}`,
      success: true,
      client,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
