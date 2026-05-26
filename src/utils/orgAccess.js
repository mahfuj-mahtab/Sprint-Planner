import Organization from "../models/organization.models.js";
import { buildOrgAccess, canManageOrgMembers, canWriteOrgResources } from "./orgRoles.js";

export const getOrgForMember = async (orgId, userId) => {
  const org = await Organization.findById(orgId);
  if (!org) {
    const err = new Error("Organization not found");
    err.status = 404;
    throw err;
  }

  const isOwner = org.owner_id.toString() === userId.toString();
  const isMember = org.members?.some(
    (m) => m.user?.toString() === userId.toString() && m.status === "active"
  );

  if (!isOwner && !isMember) {
    const err = new Error("You do not have access to this organization");
    err.status = 403;
    throw err;
  }

  const access = buildOrgAccess(org, userId);
  return { org, isOwner, role: access.role, access };
};

export const assertOrgOwner = async (orgId, userId) => {
  const { org, isOwner } = await getOrgForMember(orgId, userId);
  if (!isOwner) {
    const err = new Error("Only the organization owner can perform this action");
    err.status = 403;
    throw err;
  }
  return org;
};

export const assertCanManageOrgMembers = async (orgId, userId) => {
  const { org, access } = await getOrgForMember(orgId, userId);
  if (!canManageOrgMembers(access.role)) {
    const err = new Error("Only owners and admins can manage organization members");
    err.status = 403;
    throw err;
  }
  return { org, access };
};

export const assertCanWriteOrg = async (orgId, userId) => {
  const ctx = await getOrgForMember(orgId, userId);
  if (!canWriteOrgResources(ctx.access.role)) {
    const err = new Error("You do not have permission to change this data");
    err.status = 403;
    throw err;
  }
  return ctx;
};
