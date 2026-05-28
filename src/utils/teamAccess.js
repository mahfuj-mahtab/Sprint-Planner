import Team from "../models/team.models.js";
import { getOrgForMember } from "./orgAccess.js";

export const findProjectTeamMemberships = (teams, userId) => {
  const uid = userId.toString();
  const memberships = [];
  for (const team of teams || []) {
    const member = (team.members || []).find((m) => {
      const id = m.user?._id?.toString() || m.user?.toString();
      return id === uid;
    });
    if (member) {
      memberships.push({
        teamId: team._id?.toString(),
        role: member.role || "viewer",
      });
    }
  }
  return memberships;
};

export const buildProjectDeliveryAccess = ({ teams, userId, isOrgOwner, orgAccess }) => {
  if (isOrgOwner) {
    return {
      canWrite: true,
      readOnly: false,
      isOnProjectTeam: true,
      reason: null,
    };
  }

  if (!orgAccess?.canWrite) {
    return {
      canWrite: false,
      readOnly: true,
      isOnProjectTeam: false,
      reason: "Your organization role is view-only.",
    };
  }

  const memberships = findProjectTeamMemberships(teams, userId);
  if (!memberships.length) {
    return {
      canWrite: false,
      readOnly: true,
      isOnProjectTeam: false,
      reason:
        "You are not on a team for this project. This view is read-only until a team admin adds you.",
    };
  }

  const canWriteOnTeam = memberships.some((m) => m.role === "admin" || m.role === "editor");
  if (!canWriteOnTeam) {
    return {
      canWrite: false,
      readOnly: true,
      isOnProjectTeam: true,
      reason: "Your team role is viewer. Ask a team admin for editor access to make changes.",
    };
  }

  return {
    canWrite: true,
    readOnly: false,
    isOnProjectTeam: true,
    reason: null,
    memberships,
  };
};

export const loadProjectTeams = (orgId, projectId) =>
  Team.find({ organization_id: orgId, project_id: projectId }).lean();

export const loadUserProjectTeamIds = async (orgId, userId) => {
  const teams = await Team.find(
    { organization_id: orgId, "members.user": userId },
    { project_id: 1 }
  ).lean();
  return new Set((teams || []).map((t) => t.project_id?.toString()).filter(Boolean));
};

export const getProjectDeliveryAccess = async (orgId, projectId, userId) => {
  const { isOwner, access } = await getOrgForMember(orgId, userId);
  const teams = await loadProjectTeams(orgId, projectId);
  const deliveryAccess = buildProjectDeliveryAccess({
    teams,
    userId,
    isOrgOwner: isOwner,
    orgAccess: access,
  });
  return { access, deliveryAccess };
};

export const assertCanWriteProjectDelivery = async (orgId, projectId, userId) => {
  const ctx = await getProjectDeliveryAccess(orgId, projectId, userId);
  if (!ctx.deliveryAccess.canWrite) {
    const err = new Error(ctx.deliveryAccess.reason || "Read-only access");
    err.status = 403;
    throw err;
  }
  return ctx;
};
