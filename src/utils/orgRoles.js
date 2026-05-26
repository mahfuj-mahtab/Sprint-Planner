import { ORG_MEMBER_ROLES } from "../constants/orgRoles.js";

export const resolveOrgRole = (org, userId) => {
  if (!org || !userId) return null;
  if (org.owner_id?.toString() === userId.toString()) return "owner";

  const member = org.members?.find(
    (m) => m.user?.toString() === userId.toString() && m.status === "active"
  );
  if (!member) return null;

  const role = member.role && ORG_MEMBER_ROLES.includes(member.role) ? member.role : "viewer";
  return role;
};

export const canSeeExactAmounts = (role) => role === "owner" || role === "admin";

export const canManageOrgMembers = (role) => role === "owner" || role === "admin";

/** Delivery, CRM, finance writes (viewer is read-only). */
export const canWriteOrgResources = (role) =>
  role === "owner" || role === "admin" || role === "editor";

export const buildOrgAccess = (org, userId) => {
  const role = resolveOrgRole(org, userId);
  return {
    role,
    canSeeExactAmounts: canSeeExactAmounts(role),
    canManageMembers: canManageOrgMembers(role),
    canWrite: canWriteOrgResources(role),
    isOrgOwner: role === "owner",
  };
};

export const normalizeMemberRole = (role, fallback = "viewer") => {
  if (role && ORG_MEMBER_ROLES.includes(role)) return role;
  return fallback;
};
