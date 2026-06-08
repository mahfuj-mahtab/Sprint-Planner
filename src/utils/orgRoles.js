import { ORG_MEMBER_ROLES } from "../constants/orgRoles.js";
import { getMemberClientAccountIds } from "./clientPortalMember.js";

const memberUserId = (m) => {
  if (!m?.user) return null;
  const u = m.user;
  if (u._id) return u._id.toString();
  return u.toString();
};

export const resolveOrgRole = (org, userId) => {
  if (!org || !userId) return null;
  if (org.owner_id?.toString() === userId.toString()) return "owner";

  const uid = userId.toString();
  const member = org.members?.find(
    (m) => memberUserId(m) === uid && m.status === "active"
  );
  if (!member) return null;

  const role = member.role && ORG_MEMBER_ROLES.includes(member.role) ? member.role : "viewer";
  return role;
};

export const canSeeExactAmounts = (role) =>
  role === "owner" || role === "admin" || role === "client";

export const canManageOrgMembers = (role) => role === "owner" || role === "admin";

/** Finance tab (viewers cannot access). */
export const canAccessFinance = (role) =>
  role === "owner" || role === "admin" || role === "editor";

/** Delivery, CRM, finance writes (viewer is read-only). */
export const canWriteOrgResources = (role) =>
  role === "owner" || role === "admin" || role === "editor";

export const buildOrgAccess = (org, userId) => {
  const role = resolveOrgRole(org, userId);
  const uid = userId?.toString();
  const member = org.members?.find(
    (m) => memberUserId(m) === uid && m.status === "active"
  );
  return {
    role,
    canSeeExactAmounts: canSeeExactAmounts(role),
    canAccessFinance: canAccessFinance(role),
    canManageMembers: canManageOrgMembers(role),
    canWrite: canWriteOrgResources(role),
    isOrgOwner: role === "owner",
    isClientPortal: role === "client",
    clientAccountId: member ? getMemberClientAccountIds(member)[0] || null : null,
    clientAccountIds: member ? getMemberClientAccountIds(member) : [],
  };
};

export const normalizeMemberRole = (role, fallback = "viewer") => {
  if (role && ORG_MEMBER_ROLES.includes(role)) return role;
  return fallback;
};
