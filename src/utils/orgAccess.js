import Organization from "../models/organization.models.js";

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

  return { org, isOwner };
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
