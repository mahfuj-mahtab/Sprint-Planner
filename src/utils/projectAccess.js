/**
 * Project visibility policy:
 * - Org owner/admin can see all projects
 * - Others can see only projects where they are on at least one project team
 * - Fallback to legacy project.members check if no team visibility context is passed
 */
export const canViewProject = (
  project,
  userId,
  { isOrgOwner = false, isOrgAdmin = false, teamProjectIds = null } = {}
) => {
  if (isOrgOwner || isOrgAdmin) return true;
  if (!project) return false;
  if (teamProjectIds instanceof Set) {
    return teamProjectIds.has(project._id?.toString?.() || project.toString?.());
  }
  const members = project.members || [];
  if (!members.length) return false;
  return members.some(
    (m) => m.user?.toString() === userId.toString() && (m.status || "active") === "active"
  );
};

export const buildInitialProjectMembers = (creatorUserId, orgOwnerId) => {
  const seen = new Set();
  const members = [];

  const add = (userId, role) => {
    const key = userId.toString();
    if (seen.has(key)) return;
    seen.add(key);
    members.push({ user: userId, role, status: "active" });
  };

  add(creatorUserId, "owner");
  if (orgOwnerId && orgOwnerId.toString() !== creatorUserId.toString()) {
    add(orgOwnerId, "owner");
  }

  return members;
};

export const parseListQuery = (query, { defaultLimit = 12, maxLimit = 100 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const rawLimit = query.limit === "all" ? maxLimit : Number.parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

export const paginationMeta = (total, page, limit) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit) || 1),
});
