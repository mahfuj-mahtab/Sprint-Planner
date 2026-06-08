import Organization from "../models/organization.models.js";
import Project from "../models/project.models.js";
import Team from "../models/team.models.js";
import Sprint from "../models/sprint.models.js";
import Task from "../models/task.models.js";
import FeatureModule from "../models/featureModule.models.js";
import Feature from "../models/feature.models.js";
import ProjectVersion from "../models/projectVersion.models.js";
import {
    assertCanCreateVersion,
    assertVersionDateOverlap,
    assertVersionEditable,
    assertVersionFeaturesMutable,
    deriveVersionStatus,
    findIncompleteVersions,
    pickCurrentVersion,
} from "../utils/versionRules.js";
import { assertSprintNoOverlap } from "../utils/sprintRules.js";
import { assertValidRange } from "../utils/dateRanges.js";
import { assertCanManageOrgMembers, getOrgForMember } from "../utils/orgAccess.js";
import {
    assertCanWriteProjectDelivery,
    buildProjectDeliveryAccess,
    getProjectDeliveryAccess,
    loadUserProjectTeamIds,
    loadProjectTeams,
} from "../utils/teamAccess.js";
import {
    buildFeatureTree,
    buildTaskCountsByFeature,
    assertFeatureTargetIsLeaf,
    deleteModuleCascade,
    migrateParentFeaturesToSubModule,
    repairOrphanParentFeatures,
} from "../utils/featureTree.js";
import { parseFeatureImportPayload, importFeatureTree, FEATURE_IMPORT_TEMPLATE } from "../utils/featureImport.js";
import {
    findBillingClientsByEmail,
    grantClientPortalAccess,
    resolveClientPortalAccess,
    getClientScopeIdsForUser,
    filterProjectsForClientScope,
} from "../utils/clientPortal.js";
import { buildOrgAccess, normalizeMemberRole } from "../utils/orgRoles.js";
import {
    buildInitialProjectMembers,
    canViewProject,
    parseListQuery,
    paginationMeta,
} from "../utils/projectAccess.js";
import {
    normalizeTaskStatus,
    resolveTaskStatusForWrite,
    assertTaskTransition,
    isTaskDone,
} from "../utils/taskWorkflow.js";
import { TASK_TYPES, TASK_PRIORITIES, TASK_STATUSES, KANBAN_COLUMNS } from "../constants/taskWorkflow.js";
import {
    PROJECT_PRIORITIES,
    PROJECT_STATUSES,
    isValidProjectStatus,
    normalizeProjectStatus,
    PROJECT_PRIORITY_RANK,
} from "../constants/projectWorkflow.js";

const serializeTask = (task) => {
    const obj = task.toObject ? task.toObject() : { ...task };
    obj.status = normalizeTaskStatus(obj.status);
    return obj;
};

const serializeProject = (project) => {
    const obj = project.toObject ? project.toObject() : { ...project };
    obj.status = normalizeProjectStatus(obj.status);
    return obj;
};

const projectPriorityRank = (p) => PROJECT_PRIORITY_RANK[p] ?? 1;

const assertTaskMutateAccess = (org, task, userId) => {
    const isOwner = org.owner_id.toString() === userId.toString();
    if (isOwner) return;
    const isAssignee = (task.assignee || []).some(
        (a) => (a._id || a).toString() === userId.toString()
    );
    if (!isAssignee) {
        const err = new Error("You are not authorized to update this task");
        err.status = 403;
        throw err;
    }
};

const assertCanWriteOrgDelivery = async (orgId, userId) => {
    const { access } = await getOrgForMember(orgId, userId);
    if (!access?.canWrite) {
        const err = new Error("Your organization role is view-only.");
        err.status = 403;
        throw err;
    }
    return access;
};

const buildOrgTaskQuery = (orgId, sprintId, query = {}) => {
    const filter = { organization_id: orgId, sprint_id: sprintId };
    if (query.projectId) filter.project_id = query.projectId;
    if (query.teamId) filter.team_id = query.teamId;
    if (query.memberId) filter.assignee = query.memberId;
    if (query.status) filter.status = resolveTaskStatusForWrite(query.status);
    return filter;
};

const populateTaskQuery = (query) =>
    query
        .populate("assignee", "fullName email")
        .populate("team_id", "name project_id")
        .populate("project_id", "name status project_type")
        .populate("feature_id", "name");

const serializeBoardTask = (task) => {
    const obj = serializeTask(task);
    obj.project = obj.project_id && typeof obj.project_id === "object" ? obj.project_id : null;
    obj.team = obj.team_id && typeof obj.team_id === "object" ? obj.team_id : null;
    return obj;
};
import User from "../models/users.models.js";
import Platform, { PlatformStatus } from "../models/platform.models.js";
import Post from "../models/post.models.js";

const ensureDefaultProjectForOrg = async (orgId) => {
    const existing = await Project.findOne({ organization_id: orgId, isArchived: false }).sort({ createdAt: 1 });
    if (existing) return existing;

    const created = new Project({
        name: "General",
        description: "Default project",
        organization_id: orgId,
    });
    await created.save();
    return created;
};

const attachCurrentVersionToProjects = async (projects, orgId) => {
    const allVersions = await ProjectVersion.find({ organization_id: orgId });
    return projects.map((p) => {
        const projectVersions = allVersions.filter((v) => v.project_id?.toString() === p._id.toString());
        const current = pickCurrentVersion(projectVersions);
        const obj = typeof p.toObject === "function" ? p.toObject() : { ...p };
        return {
            ...obj,
            currentVersion: current
                ? {
                      _id: current._id,
                      name: current.name,
                      status: current.status,
                      start_date: current.start_date,
                      end_date: current.end_date,
                      is_locked: current.is_locked,
                  }
                : null,
        };
    });
};

const backfillProjectIdsForOrg = async (orgId, projectId) => {
    await Promise.all([
        Sprint.updateMany(
            { organization_id: orgId, $or: [{ project_id: { $exists: false } }, { project_id: null }] },
            { $set: { project_id: projectId } }
        ),
        Team.updateMany(
            { organization_id: orgId, $or: [{ project_id: { $exists: false } }, { project_id: null }] },
            { $set: { project_id: projectId } }
        ),
    ]);
};

const assertOrgOwner = (org, userId) => {
    if (org.owner_id.toString() !== userId) {
        const err = new Error("FORBIDDEN");
        err.status = 403;
        throw err;
    }
};

const computeFeatureStatus = ({ totalTasks, completedTasks }) => {
    if (!totalTasks) return "pending";
    if (completedTasks >= totalTasks) return "completed";
    if (completedTasks > 0) return "in-progress";
    return "pending";
};

const computeModuleStatus = (features) => {
    if (!features || features.length === 0) return "pending";
    const completed = features.filter(f => f.status === "completed").length;
    if (completed === features.length) return "completed";
    if (completed > 0) return "in-progress";
    return "pending";
};

const normalizeIdSet = (ids) => {
    const set = new Set();
    for (const id of ids || []) {
        if (!id) continue;
        set.add(id.toString());
    }
    return set;
};
export const orgCreate = async (req, res) => {
    const { name, description } = req.body;
    const owner_id = req.user._id;

    if (!name || !description) {
        return res.status(400).json({ message: "Name and description are required", success: false });
    }

    try {
        const newOrg = new Organization({ 
            name, 
            description, 
            owner_id,
            members: [{ user: owner_id, status: "active", role: "admin" }],
        });
        await newOrg.save();

        res.status(201).json({
            message: "Organization created successfully",
            success: true,
            organization: newOrg,
        });
    } catch (error) {
        res.status(500).json({ message: "Error creating organization", error, success: false });
    }
}

export const orgEdit = async (req, res) => {
    const { orgId } = req.params;
    const { name, description } = req.body;

    if (!name && !description) {
        return res.status(400).json({ message: "At least one field (name or description) is required to update", success: false });
    }

    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }

        if (org.owner_id.toString() !== req.user._id) {
            return res.status(403).json({ message: "You do not have permission to edit this organization", success: false });
        }

        if (name) org.name = name;
        if (description) org.description = description;

        await org.save();
        res.status(200).json({
            message: "Organization updated successfully",
            success: true,
            organization: org,
        });
    } catch (error) {
        res.status(500).json({ message: "Error updating organization", error, success: false });
    }
}

export const orgDelete = async (req, res) => {
    const { orgId } = req.params;

    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }
        if (org.owner_id.toString() !== req.user._id) {
            return res.status(403).json({ message: "You do not have permission to delete this organization", success: false });
        }

        await Organization.findByIdAndDelete(orgId);
        res.status(200).json({
            message: "Organization deleted successfully",
            success: true,
        });
    } catch (error) {
        res.status(500).json({ message: "Error deleting organization", error, success: false });
    }
}

export const orgGet = async (req, res) => {
    const { orgId } = req.params;

    try {
        let { org, isOwner, access } = await getOrgForMember(orgId, req.user._id);

        const portalMembership = await resolveClientPortalAccess(
            org,
            req.user._id,
            req.user.email,
            { sync: true }
        );
        let clientScopeIds = null;
        if (portalMembership) {
            org = await Organization.findById(orgId);
            clientScopeIds = await getClientScopeIdsForUser(orgId, org, req.user._id, req.user.email);
        }

        await org.populate("members.user", "-password");

        const defaultProject = await ensureDefaultProjectForOrg(orgId);
        await backfillProjectIdsForOrg(orgId, defaultProject._id);

        const projectsRaw = await Project.find({ organization_id: orgId, isArchived: false })
            .sort({ createdAt: 1 })
            .lean();
        const teamProjectIds = await loadUserProjectTeamIds(orgId, req.user._id);
        let visibleRaw;
        if (clientScopeIds) {
            visibleRaw = filterProjectsForClientScope(projectsRaw, clientScopeIds);
        } else {
            visibleRaw = projectsRaw.filter((p) =>
                canViewProject(p, req.user._id, {
                    isOrgOwner: isOwner,
                    isOrgAdmin: access?.role === "admin",
                    teamProjectIds,
                })
            );
        }
        const projects = await attachCurrentVersionToProjects(visibleRaw, orgId);

        const requestedProjectId = req.query?.projectId;
        let selectedProjectId;

        if (requestedProjectId) {
            const requested =
                visibleRaw.find((p) => p._id.toString() === requestedProjectId) ||
                (await Project.findOne({ _id: requestedProjectId, organization_id: orgId }).lean());
            if (!requested) {
                return res.status(404).json({ message: "Project not found", success: false });
            }
            const canAccessRequested = clientScopeIds
                ? filterProjectsForClientScope([requested], clientScopeIds).length > 0
                : canViewProject(requested, req.user._id, {
                      isOrgOwner: isOwner,
                      isOrgAdmin: access?.role === "admin",
                      teamProjectIds,
                  });
            if (!canAccessRequested) {
                return res.status(403).json({ message: "You do not have access to this project", success: false });
            }
            selectedProjectId = requestedProjectId;
        } else {
            selectedProjectId =
                visibleRaw[0]?._id?.toString() || defaultProject._id.toString();
        }

        const sprints = await Sprint.find({ organization_id: orgId, project_id: selectedProjectId }).sort({ createdAt: -1 });
        const teams = await Team.find({ organization_id: orgId, project_id: selectedProjectId }).populate('members.user', '-password');

        const sprintDetails = [];
        for (const sprint of sprints) {
            const tasks = await Task.find({ sprint_id: sprint._id, organization_id: orgId });
            const total_tasks = tasks.length;
            const completed_tasks = tasks.filter((task) => isTaskDone(task.status)).length;
            sprintDetails.push({
                sprint,
                total_tasks,
                completed_tasks,
            });
        }

        const accessCtx = buildOrgAccess(org, req.user._id);
        const clientAccess =
            accessCtx.role === "client" && clientScopeIds
                ? {
                      ...accessCtx,
                      canWrite: false,
                      canAccessFinance: false,
                      canManageMembers: false,
                      isClientPortal: true,
                      clientScopeIds,
                  }
                : accessCtx;
        const deliveryAccess = buildProjectDeliveryAccess({
            teams,
            userId: req.user._id,
            isOrgOwner: isOwner,
            orgAccess: clientAccess,
        });

        res.status(200).json({
            message: "Organization retrieved successfully",
            success: true,
            organization: org,
            access: clientAccess,
            deliveryAccess,
            projects,
            selectedProjectId,
            sprints: sprints,
            teams: teams,
            sprintDetails: sprintDetails
        });
    } catch (error) {
        res.status(500).json({ message: "Error retrieving organization", error, success: false });
    }

}
export const orgAccessGet = async (req, res) => {
    const { orgId } = req.params;
    try {
        const { access } = await getOrgForMember(orgId, req.user._id);
        return res.status(200).json({ success: true, access });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Failed to load access",
            success: false,
        });
    }
};

export const orgMemberAdd = async (req, res) => {
    const { orgId } = req.params;
    const { email, role, status } = req.body;

    try {
        const { org } = await assertCanManageOrgMembers(orgId, req.user._id);

        if (!email?.trim()) {
            return res.status(400).json({ message: "Email is required", success: false });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase() });
        if (!user) {
            return res.status(400).json({ message: "No user found with that email", success: false });
        }

        if (org.owner_id.toString() === user._id.toString()) {
            return res.status(400).json({ message: "User is already the organization owner", success: false });
        }

        const isMemberAlready = org.members.find((m) => m.user.toString() === user._id.toString());
        if (isMemberAlready) {
            return res.status(400).json({ message: "User is already a member", success: false });
        }

        const memberStatus = ["active", "pending", "inactive", "banned"].includes(status)
            ? status
            : "active";

        org.members.push({
            user: user._id,
            status: memberStatus,
            role: normalizeMemberRole(role, "viewer"),
        });

        const billingClients = await findBillingClientsByEmail(orgId, user.email);
        if (billingClients.length) {
            const added = org.members[org.members.length - 1];
            added.role = "client";
            added.client_account_ids = billingClients.map((c) => c._id);
            added.client_account_id = billingClients[0]._id;
        }

        await org.save();
        await org.populate("members.user", "-password");

        return res.status(200).json({
            message: "Member added successfully",
            success: true,
            members: org.members,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Failed to add member",
            success: false,
        });
    }
};

export const orgMemberUpdate = async (req, res) => {
    const { orgId, memberId } = req.params;
    const { role, status } = req.body;

    try {
        const { org } = await assertCanManageOrgMembers(orgId, req.user._id);

        if (org.owner_id.toString() === memberId) {
            return res.status(400).json({ message: "Cannot change the organization owner", success: false });
        }

        const member = org.members.find((m) => m.user.toString() === memberId);
        if (!member) {
            return res.status(404).json({ message: "Member not found", success: false });
        }

        if (role !== undefined) member.role = normalizeMemberRole(role, member.role);
        if (status !== undefined) {
            if (!["active", "pending", "inactive", "banned"].includes(status)) {
                return res.status(400).json({ message: "Invalid status", success: false });
            }
            member.status = status;
        }

        await org.save();
        await org.populate("members.user", "-password");

        return res.status(200).json({
            message: "Member updated",
            success: true,
            members: org.members,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Failed to update member",
            success: false,
        });
    }
};

export const orgMemberRemove = async (req, res) => {
    const { orgId, memberId } = req.params;

    try {
        const { org } = await assertCanManageOrgMembers(orgId, req.user._id);

        if (org.owner_id.toString() === memberId) {
            return res.status(400).json({ message: "Cannot remove the organization owner", success: false });
        }

        const exists = org.members.some((m) => m.user.toString() === memberId);
        if (!exists) {
            return res.status(404).json({ message: "Member not found", success: false });
        }

        org.members = org.members.filter((m) => m.user.toString() !== memberId);
        await org.save();
        await org.populate("members.user", "-password");

        return res.status(200).json({
            message: "Member removed",
            success: true,
            members: org.members,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Failed to remove member",
            success: false,
        });
    }
};

export const orgFetchAllMembers = async (req, res) => {
    const { orgId } = req.params;
    try {
        const { org, access } = await getOrgForMember(orgId, req.user._id);
        await org.populate([
            { path: "members.user", select: "-password" },
            { path: "owner_id", select: "-password" },
        ]);

        return res.status(200).json({
            message: "Organization members fetched successfully",
            success: true,
            members: org.members,
            owner_id: org.owner_id?._id || org.owner_id,
            owner: org.owner_id,
            access,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Failed to fetch members",
            success: false,
        });
    }
};

export const orgProjectList = async (req, res) => {
    const { orgId } = req.params;
    const { search, status, project_type, archived } = req.query;
    try {
        const { org, isOwner, access } = await getOrgForMember(orgId, req.user._id);

        let clientScopeIds = null;
        const portalAccess = await resolveClientPortalAccess(org, req.user._id, req.user.email, { sync: true });
        if (portalAccess) {
            clientScopeIds = await getClientScopeIdsForUser(orgId, org, req.user._id, req.user.email);
        }

        const defaultProject = await ensureDefaultProjectForOrg(orgId);
        await backfillProjectIdsForOrg(orgId, defaultProject._id);

        const filter = { organization_id: orgId };
        if (archived === "true") filter.isArchived = true;
        else if (archived !== "all") filter.isArchived = false;
        if (status && isValidProjectStatus(status)) filter.status = status;
        else if (status === "in_progress") {
            filter.status = { $in: ["in_progress", "active"] };
        } else if (status === "on_hold") {
            filter.status = { $in: ["on_hold", "paused"] };
        }
        if (project_type && ["product", "client_work", "internal"].includes(project_type)) {
            filter.project_type = project_type;
        }
        if (search?.trim()) {
            filter.name = { $regex: search.trim(), $options: "i" };
        }

        const allMatching = await Project.find(filter).sort({ createdAt: -1 }).lean();
        const teamProjectIds = await loadUserProjectTeamIds(orgId, req.user._id);
        let visible;
        if (clientScopeIds) {
            visible = filterProjectsForClientScope(allMatching, clientScopeIds);
        } else {
            visible = allMatching.filter((p) =>
                canViewProject(p, req.user._id, {
                    isOrgOwner: isOwner,
                    isOrgAdmin: access?.role === "admin",
                    teamProjectIds,
                })
            );
        }
        visible = visible
            .map(serializeProject)
            .sort((a, b) => {
                const pr = projectPriorityRank(a.priority) - projectPriorityRank(b.priority);
                if (pr !== 0) return pr;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

        const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 12, maxLimit: 100 });
        const total = visible.length;
        const pageItems = visible.slice(skip, skip + limit);
        const enriched = await attachCurrentVersionToProjects(pageItems, orgId);

        return res.status(200).json({
            message: "Projects fetched successfully",
            success: true,
            projects: enriched,
            pagination: paginationMeta(total, page, limit),
            isOrgOwner: isOwner,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Error fetching projects",
            error: status === 500 ? error : undefined,
            success: false,
        });
    }
};

export const orgProjectCreate = async (req, res) => {
    const { orgId } = req.params;
    const { name, description, documentation, client_id, project_type, status, budget, priority, start_date, end_date } = req.body;

    if (!name) {
        return res.status(400).json({ message: "Project name is required", success: false });
    }

    try {
        await assertCanWriteOrgDelivery(orgId, req.user._id);
        const { org } = await getOrgForMember(orgId, req.user._id);

        const normalizedStatus = status && isValidProjectStatus(status) ? normalizeProjectStatus(status) : "pending";
        const normalizedPriority = PROJECT_PRIORITIES.includes(priority) ? priority : "medium";

        const project = new Project({
            name: name.trim(),
            description: (description || "").trim(),
            documentation: (documentation || "").trim(),
            organization_id: orgId,
            client_id: client_id || null,
            project_type: project_type || "product",
            status: normalizedStatus,
            priority: normalizedPriority,
            start_date: start_date ? new Date(start_date) : null,
            end_date: end_date ? new Date(end_date) : null,
            budget: budget != null && budget !== "" ? Number(budget) : null,
            members: buildInitialProjectMembers(req.user._id, org.owner_id),
        });
        await project.save();

        return res.status(201).json({ message: "Project created successfully", success: true, project: serializeProject(project) });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A project with this name already exists" : "Error creating project",
            error,
            success: false,
        });
    }
};

export const orgProjectEdit = async (req, res) => {
    const { orgId, projectId } = req.params;
    const {
        name,
        description,
        documentation,
        isArchived,
        client_id,
        project_type,
        status,
        budget,
        priority,
        start_date,
        end_date,
    } = req.body;

    if (
        !name &&
        !description &&
        typeof documentation !== "string" &&
        typeof isArchived !== "boolean" &&
        client_id === undefined &&
        !project_type &&
        !status &&
        budget === undefined &&
        priority === undefined &&
        start_date === undefined &&
        end_date === undefined
    ) {
        return res.status(400).json({ message: "Nothing to update", success: false });
    }

    try {
        await assertCanWriteOrgDelivery(orgId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) {
            return res.status(404).json({ message: "Project not found", success: false });
        }

        if (name) project.name = name.trim();
        if (typeof description === "string") project.description = description.trim();
        if (typeof documentation === "string") project.documentation = documentation.trim();
        if (typeof isArchived === "boolean") project.isArchived = isArchived;
        if (client_id !== undefined) project.client_id = client_id || null;
        if (project_type) project.project_type = project_type;
        if (status && isValidProjectStatus(status)) project.status = normalizeProjectStatus(status);
        if (priority !== undefined) {
            project.priority = PROJECT_PRIORITIES.includes(priority) ? priority : project.priority;
        }
        if (start_date !== undefined) project.start_date = start_date ? new Date(start_date) : null;
        if (end_date !== undefined) project.end_date = end_date ? new Date(end_date) : null;
        if (budget !== undefined) project.budget = budget != null && budget !== "" ? Number(budget) : null;

        await project.save();
        return res.status(200).json({ message: "Project updated successfully", success: true, project: serializeProject(project) });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A project with this name already exists" : "Error updating project",
            error,
            success: false,
        });
    }
};

export const orgProjectDelete = async (req, res) => {
    const { orgId, projectId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }
        if (org.owner_id.toString() !== req.user._id) {
            return res.status(403).json({ message: "You do not have permission to delete projects for this organization", success: false });
        }

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) {
            return res.status(404).json({ message: "Project not found", success: false });
        }

        const sprints = await Sprint.find({ organization_id: orgId, project_id: projectId }, { _id: 1 });
        const sprintIds = sprints.map(s => s._id);

        await Promise.all([
            Task.deleteMany({ organization_id: orgId, $or: [{ project_id: projectId }, { sprint_id: { $in: sprintIds } }] }),
            Sprint.deleteMany({ organization_id: orgId, project_id: projectId }),
            Team.deleteMany({ organization_id: orgId, project_id: projectId }),
        ]);
        await project.deleteOne();

        return res.status(200).json({ message: "Project deleted successfully", success: true });
    } catch (error) {
        return res.status(500).json({ message: "Error deleting project", error, success: false });
    }
};

export const orgProjectSprintList = async (req, res) => {
    const { orgId, projectId } = req.params;
    const { search, active } = req.query;

    try {
        const { isOwner, access } = await getOrgForMember(orgId, req.user._id);
        const project = await Project.findOne({ _id: projectId, organization_id: orgId }).lean();
        if (!project) {
            return res.status(404).json({ message: "Project not found", success: false });
        }
        const teamProjectIds = await loadUserProjectTeamIds(orgId, req.user._id);
        if (
            !canViewProject(project, req.user._id, {
                isOrgOwner: isOwner,
                isOrgAdmin: access?.role === "admin",
                teamProjectIds,
            })
        ) {
            return res.status(403).json({ message: "You do not have access to this project", success: false });
        }

        const filter = { organization_id: orgId, project_id: projectId };
        if (active === "true") filter.isActive = true;
        if (active === "false") filter.isActive = false;
        if (search?.trim()) filter.name = { $regex: search.trim(), $options: "i" };

        const allSprints = await Sprint.find(filter).sort({ createdAt: -1 }).lean();
        const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 50 });
        const total = allSprints.length;
        const sprints = allSprints.slice(skip, skip + limit);

        const sprintDetails = [];
        for (const sprint of sprints) {
            const tasks = await Task.find({ sprint_id: sprint._id, organization_id: orgId });
            sprintDetails.push({
                sprint,
                total_tasks: tasks.length,
                completed_tasks: tasks.filter((task) => isTaskDone(task.status)).length,
            });
        }

        return res.status(200).json({
            message: "Sprints fetched successfully",
            success: true,
            sprintDetails,
            pagination: paginationMeta(total, page, limit),
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Error fetching sprints",
            success: false,
        });
    }
};

export const orgSprintList = async (req, res) => {
    const { orgId } = req.params;
    const { search, active } = req.query;

    try {
        await getOrgForMember(orgId, req.user._id);
        const filter = { organization_id: orgId };
        if (active === "true") filter.isActive = true;
        if (active === "false") filter.isActive = false;
        if (search?.trim()) filter.name = { $regex: search.trim(), $options: "i" };

        const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
        const [total, sprints] = await Promise.all([
            Sprint.countDocuments(filter),
            Sprint.find(filter).sort({ isActive: -1, startDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        ]);

        const sprintDetails = [];
        for (const sprint of sprints) {
            const tasks = await Task.find({ sprint_id: sprint._id, organization_id: orgId });
            sprintDetails.push({
                sprint,
                total_tasks: tasks.length,
                completed_tasks: tasks.filter((task) => isTaskDone(task.status)).length,
            });
        }

        return res.status(200).json({
            message: "Sprints fetched successfully",
            success: true,
            sprintDetails,
            pagination: paginationMeta(total, page, limit),
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || "Error fetching organization sprints",
            success: false,
        });
    }
};

export const orgSprintTaskBoard = async (req, res) => {
    const { orgId, sprintId } = req.params;

    try {
        const { isOwner, access } = await getOrgForMember(orgId, req.user._id);
        const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId }).lean();
        if (!sprint) return res.status(404).json({ message: "Sprint not found", success: false });

        const [projects, teams, tasks] = await Promise.all([
            Project.find({ organization_id: orgId, isArchived: false }).sort({ name: 1 }).lean(),
            Team.find({ organization_id: orgId }).populate("members.user", "fullName email").sort({ name: 1 }).lean(),
            populateTaskQuery(Task.find(buildOrgTaskQuery(orgId, sprintId, req.query)).sort({ updatedAt: -1 })),
        ]);

        const serializedTasks = tasks.map(serializeBoardTask);
        const visibleTeamIds = new Set(teams.map((team) => team._id.toString()));
        const teamsWithTasks = teams
            .filter((team) => !req.query.projectId || team.project_id?.toString() === req.query.projectId)
            .filter((team) => !req.query.teamId || team._id.toString() === req.query.teamId)
            .map((team) => ({
                ...team,
                tasks: serializedTasks.filter((task) => task.team_id?._id?.toString() === team._id.toString() || task.team_id?.toString?.() === team._id.toString()),
                completed_task: serializedTasks.filter((task) => isTaskDone(task.status) && (task.team_id?._id?.toString() === team._id.toString() || task.team_id?.toString?.() === team._id.toString())).length,
            }));

        const ungroupedTasks = serializedTasks.filter((task) => {
            const id = task.team_id?._id?.toString() || task.team_id?.toString?.();
            return id && !visibleTeamIds.has(id);
        });

        if (ungroupedTasks.length) {
            teamsWithTasks.push({
                _id: "unassigned",
                name: "Filtered tasks",
                members: [],
                tasks: ungroupedTasks,
                completed_task: ungroupedTasks.filter((task) => isTaskDone(task.status)).length,
            });
        }

        const deliveryAccess = {
            canWrite: Boolean(isOwner || access?.canWrite),
            readOnly: !(isOwner || access?.canWrite),
            reason: isOwner || access?.canWrite ? null : "Your organization role is view-only.",
        };

        return res.status(200).json({
            message: "Task board fetched successfully",
            success: true,
            sprint,
            projects,
            teams: teamsWithTasks,
            filters: {
                projects,
                teams,
                members: (await Organization.findById(orgId).populate("members.user", "fullName email").lean())?.members || [],
            },
            access,
            deliveryAccess,
            workflow: {
                statuses: TASK_STATUSES,
                kanbanColumns: KANBAN_COLUMNS,
            },
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || "Error fetching task board",
            success: false,
        });
    }
};

export const orgProjectDetails = async (req, res) => {
    const { orgId, projectId } = req.params;
    try {
        const { isOwner, access } = await getOrgForMember(orgId, req.user._id);
        const org = await Organization.findById(orgId).populate("members.user", "-password");
        if (!org) {
            return res.status(404).json({ message: "Organization not found", success: false });
        }

        const defaultProject = await ensureDefaultProjectForOrg(orgId);
        await backfillProjectIdsForOrg(orgId, defaultProject._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) {
            return res.status(404).json({ message: "Project not found", success: false });
        }
        const teamProjectIds = await loadUserProjectTeamIds(orgId, req.user._id);
        if (
            !canViewProject(project, req.user._id, {
                isOrgOwner: isOwner,
                isOrgAdmin: access?.role === "admin",
                teamProjectIds,
            })
        ) {
            return res.status(403).json({ message: "You do not have access to this project", success: false });
        }

        const sprints = await Sprint.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: -1 });
        const teams = await Team.find({ organization_id: orgId, project_id: projectId }).populate('members.user', '-password');

        const sprintDetails = [];
        for (const sprint of sprints) {
            const tasks = await Task.find({ sprint_id: sprint._id, organization_id: orgId });
            const total_tasks = tasks.length;
            const completed_tasks = tasks.filter((task) => isTaskDone(task.status)).length;
            sprintDetails.push({ sprint, total_tasks, completed_tasks });
        }

        return res.status(200).json({
            message: "Project details retrieved successfully",
            success: true,
            organization: org,
            project,
            sprints,
            teams,
            sprintDetails,
        });
    } catch (error) {
        return res.status(500).json({ message: "Error retrieving project details", error, success: false });
    }
};

export const orgFeatureAnalysisSummary = async (req, res) => {
    const { orgId, projectId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await getOrgForMember(orgId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        let modules = await FeatureModule.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 });
        let features = await Feature.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 });

        const repaired = await repairOrphanParentFeatures(orgId, projectId, modules, features);
        if (repaired) {
            features = await Feature.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 });
        }

        const tasks = await Task.find(
            { organization_id: orgId, project_id: projectId, feature_id: { $ne: null } },
            { feature_id: 1, status: 1 }
        ).lean();

        const taskCountsByFeature = buildTaskCountsByFeature(tasks);
        const moduleViews = buildFeatureTree(modules, features, taskCountsByFeature);

        return res.status(200).json({
            message: "Feature analysis retrieved successfully",
            success: true,
            project,
            modules: moduleViews,
        });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error retrieving feature analysis", error, success: false });
    }
};

export const orgFeatureModuleCreate = async (req, res) => {
    const { orgId, projectId } = req.params;
    const { name, parent_module_id: parentModuleId } = req.body;
    if (!name) return res.status(400).json({ message: "Module name is required", success: false });
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        let parent_module_id = null;
        if (parentModuleId) {
            const parent = await FeatureModule.findOne({
                _id: parentModuleId,
                organization_id: orgId,
                project_id: projectId,
                parent_module_id: null,
            });
            if (!parent) {
                return res.status(400).json({
                    message: "Parent must be a top-level module",
                    success: false,
                });
            }
            parent_module_id = parent._id;
        }

        const mod = new FeatureModule({
            name: name.trim(),
            organization_id: orgId,
            project_id: projectId,
            parent_module_id,
        });
        await mod.save();

        let movedFeatures = 0;
        if (parent_module_id) {
            movedFeatures = await migrateParentFeaturesToSubModule(
                orgId,
                projectId,
                parent_module_id,
                mod._id
            );
        }

        return res.status(201).json({
            message: parent_module_id
                ? movedFeatures
                    ? `Sub-module created — ${movedFeatures} feature${movedFeatures === 1 ? "" : "s"} moved here`
                    : "Sub-module created successfully"
                : "Module created successfully",
            success: true,
            module: mod,
            movedFeatures,
        });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A module with this name already exists" : "Error creating module",
            error,
            success: false,
        });
    }
};

export const orgFeatureModuleEdit = async (req, res) => {
    const { orgId, projectId, moduleId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Module name is required", success: false });
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const mod = await FeatureModule.findOne({ _id: moduleId, organization_id: orgId, project_id: projectId });
        if (!mod) return res.status(404).json({ message: "Module not found", success: false });
        mod.name = name.trim();
        await mod.save();
        return res.status(200).json({ message: "Module updated successfully", success: true, module: mod });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A module with this name already exists" : "Error updating module",
            error,
            success: false,
        });
    }
};

export const orgFeatureModuleDelete = async (req, res) => {
    const { orgId, projectId, moduleId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const mod = await FeatureModule.findOne({ _id: moduleId, organization_id: orgId, project_id: projectId });
        if (!mod) return res.status(404).json({ message: "Module not found", success: false });

        await deleteModuleCascade(orgId, projectId, moduleId);

        return res.status(200).json({ message: "Module deleted successfully", success: true });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error deleting module", error, success: false });
    }
};

export const orgFeatureCreate = async (req, res) => {
    const { orgId, projectId, moduleId } = req.params;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: "Feature name is required", success: false });
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const mod = await FeatureModule.findOne({ _id: moduleId, organization_id: orgId, project_id: projectId });
        if (!mod) return res.status(404).json({ message: "Module not found", success: false });
        await assertFeatureTargetIsLeaf(orgId, projectId, moduleId);

        const feat = new Feature({
            name: name.trim(),
            description: (description || "").trim(),
            organization_id: orgId,
            project_id: projectId,
            module_id: moduleId,
        });
        await feat.save();
        return res.status(201).json({ message: "Feature created successfully", success: true, feature: feat });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A feature with this name already exists in this module" : "Error creating feature",
            error,
            success: false,
        });
    }
};

export const orgFeatureEdit = async (req, res) => {
    const { orgId, projectId, featureId } = req.params;
    const { name, moduleId, description } = req.body;
    if (!name && !moduleId && description === undefined) {
        return res.status(400).json({ message: "Nothing to update", success: false });
    }
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const feat = await Feature.findOne({ _id: featureId, organization_id: orgId, project_id: projectId });
        if (!feat) return res.status(404).json({ message: "Feature not found", success: false });

        if (moduleId) {
            const mod = await FeatureModule.findOne({ _id: moduleId, organization_id: orgId, project_id: projectId });
            if (!mod) return res.status(404).json({ message: "Module not found", success: false });
            await assertFeatureTargetIsLeaf(orgId, projectId, moduleId);
            feat.module_id = moduleId;
        }
        if (name) feat.name = name.trim();
        if (description !== undefined) feat.description = String(description || "").trim();

        await feat.save();
        return res.status(200).json({ message: "Feature updated successfully", success: true, feature: feat });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        return res.status(isDuplicate ? 409 : 500).json({
            message: isDuplicate ? "A feature with this name already exists in this module" : "Error updating feature",
            error,
            success: false,
        });
    }
};

export const orgFeatureDelete = async (req, res) => {
    const { orgId, projectId, featureId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const feat = await Feature.findOne({ _id: featureId, organization_id: orgId, project_id: projectId });
        if (!feat) return res.status(404).json({ message: "Feature not found", success: false });

        await Promise.all([
            Task.updateMany({ organization_id: orgId, project_id: projectId, feature_id: featureId }, { $set: { feature_id: null } }),
            feat.deleteOne(),
        ]);

        return res.status(200).json({ message: "Feature deleted successfully", success: true });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error deleting feature", error, success: false });
    }
};

export const orgFeatureImport = async (req, res) => {
    const { orgId, projectId } = req.params;
    const mode = req.body?.mode === "replace" ? "replace" : "merge";

    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        const parsed = parseFeatureImportPayload(req.body?.modules ?? req.body);
        const stats = await importFeatureTree(orgId, projectId, parsed, { mode });

        return res.status(200).json({
            success: true,
            message: "Feature tree imported",
            stats,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Import failed",
            success: false,
        });
    }
};

export const orgFeatureImportTemplate = async (_req, res) => {
    return res.status(200).json({ success: true, template: FEATURE_IMPORT_TEMPLATE });
};

export const orgProjectVersionList = async (req, res) => {
    const { orgId, projectId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await getOrgForMember(orgId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        const versions = await ProjectVersion.find({ organization_id: orgId, project_id: projectId })
            .sort({ start_date: 1 })
            .lean();

        const incomplete = findIncompleteVersions(versions);
        const current = pickCurrentVersion(versions);

        return res.status(200).json({
            message: "Versions fetched successfully",
            success: true,
            versions,
            currentVersionId: current?._id || null,
            canCreateVersion: incomplete.length === 0,
            createBlockedReason: incomplete.length
                ? `Complete "${incomplete[0].name}" before creating another version`
                : null,
        });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error fetching versions", error, success: false });
    }
};

export const orgProjectVersionCreate = async (req, res) => {
    const { orgId, projectId } = req.params;
    const { name, description, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ message: "Version name is required", success: false });
    if (!start_date || !end_date) {
        return res.status(400).json({ message: "Start date and end date are required", success: false });
    }
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        await assertCanCreateVersion(orgId, projectId);
        const { start, end } = await assertVersionDateOverlap(orgId, projectId, start_date, end_date);
        const status = deriveVersionStatus(start, end);

        const version = new ProjectVersion({
            name: name.trim(),
            description: (description || "").trim(),
            organization_id: orgId,
            project_id: projectId,
            feature_ids: [],
            start_date: start,
            end_date: end,
            status,
            is_locked: false,
        });
        await version.save();

        return res.status(201).json({ message: "Version created successfully", success: true, version });
    } catch (error) {
        const isDuplicate = error?.code === 11000;
        const status = error.status || (isDuplicate ? 409 : 500);
        return res.status(status).json({
            message: isDuplicate ? "A version with this name already exists" : error.message || "Error creating version",
            error: status === 500 ? error : undefined,
            success: false,
        });
    }
};

export const orgProjectVersionUpdate = async (req, res) => {
    const { orgId, projectId, versionId } = req.params;
    const body = req.body;

    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const version = await ProjectVersion.findOne({ _id: versionId, organization_id: orgId, project_id: projectId });
        if (!version) return res.status(404).json({ message: "Version not found", success: false });

        if (body.complete === true) {
            version.status = "completed";
            await version.save();
            return res.status(200).json({ message: "Version marked completed", success: true, version });
        }

        if (typeof body.is_locked === "boolean") {
            version.is_locked = body.is_locked;
            await version.save();
            return res.status(200).json({
                message: version.is_locked ? "Version locked" : "Version unlocked",
                success: true,
                version,
            });
        }

        assertVersionEditable(version);

        if (body.name) version.name = body.name.trim();
        if (typeof body.description === "string") version.description = body.description.trim();

        if (body.start_date || body.end_date) {
            const start = body.start_date || version.start_date;
            const end = body.end_date || version.end_date;
            await assertVersionDateOverlap(orgId, projectId, start, end, versionId);
            version.start_date = assertValidRange(start, end).start;
            version.end_date = assertValidRange(start, end).end;
            version.status = deriveVersionStatus(version.start_date, version.end_date);
        }

        await version.save();
        return res.status(200).json({ message: "Version updated", success: true, version });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Error updating version",
            success: false,
        });
    }
};

export const orgProjectVersionDelete = async (req, res) => {
    const { orgId, projectId, versionId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const version = await ProjectVersion.findOne({ _id: versionId, organization_id: orgId, project_id: projectId });
        if (!version) return res.status(404).json({ message: "Version not found", success: false });

        if (version.is_locked) {
            return res.status(403).json({ message: "Unlock the version before deleting", success: false });
        }
        if (version.status === "active") {
            return res.status(403).json({ message: "Complete or pause the active version before deleting", success: false });
        }

        await version.deleteOne();
        return res.status(200).json({ message: "Version deleted successfully", success: true });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error deleting version", error, success: false });
    }
};

export const orgProjectVersionAssignFeature = async (req, res) => {
    const { orgId, projectId, versionId } = req.params;
    const { featureId } = req.body;
    if (!featureId) return res.status(400).json({ message: "featureId is required", success: false });
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const version = await ProjectVersion.findOne({ _id: versionId, organization_id: orgId, project_id: projectId });
        if (!version) return res.status(404).json({ message: "Version not found", success: false });

        try {
            assertVersionFeaturesMutable(version);
        } catch (e) {
            return res.status(e.status || 403).json({ message: e.message, success: false });
        }

        const feature = await Feature.findOne({ _id: featureId, organization_id: orgId, project_id: projectId });
        if (!feature) return res.status(400).json({ message: "Invalid feature for this project", success: false });

        const existing = normalizeIdSet(version.feature_ids);
        if (existing.has(featureId.toString())) {
            return res.status(200).json({ message: "Feature already assigned", success: true, version });
        }

        version.feature_ids.push(feature._id);
        await version.save();

        return res.status(200).json({ message: "Feature assigned to version", success: true });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error assigning feature", error, success: false });
    }
};

export const orgProjectVersionRemoveFeature = async (req, res) => {
    const { orgId, projectId, versionId, featureId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

        const version = await ProjectVersion.findOne({ _id: versionId, organization_id: orgId, project_id: projectId });
        if (!version) return res.status(404).json({ message: "Version not found", success: false });

        try {
            assertVersionFeaturesMutable(version);
        } catch (e) {
            return res.status(e.status || 403).json({ message: e.message, success: false });
        }

        version.feature_ids = (version.feature_ids || []).filter((id) => id.toString() !== featureId.toString());
        await version.save();

        return res.status(200).json({ message: "Feature removed from version", success: true });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error removing feature", error, success: false });
    }
};

export const orgProjectVersionDetails = async (req, res) => {
    const { orgId, projectId, versionId } = req.params;
    try {
        const org = await Organization.findById(orgId);
        if (!org) return res.status(404).json({ message: "Organization not found", success: false });
        await getOrgForMember(orgId, req.user._id);

        const project = await Project.findOne({ _id: projectId, organization_id: orgId });
        if (!project) return res.status(404).json({ message: "Project not found", success: false });

        const version = await ProjectVersion.findOne({ _id: versionId, organization_id: orgId, project_id: projectId }).lean();
        if (!version) return res.status(404).json({ message: "Version not found", success: false });

        const featureIds = (version.feature_ids || []).map((id) => id.toString());
        if (featureIds.length === 0) {
            return res.status(200).json({
                message: "Version details retrieved successfully",
                success: true,
                project,
                version,
                modules: [],
            });
        }

        const features = await Feature.find({ _id: { $in: featureIds }, organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 });
        const allModules = await FeatureModule.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 });

        const neededModuleIds = new Set(features.map((f) => f.module_id.toString()));
        const modById = new Map(allModules.map((m) => [m._id.toString(), m]));
        for (const mid of [...neededModuleIds]) {
            let mod = modById.get(mid);
            while (mod?.parent_module_id) {
                const pid = mod.parent_module_id.toString();
                neededModuleIds.add(pid);
                mod = modById.get(pid);
            }
        }
        const modules = allModules.filter((m) => neededModuleIds.has(m._id.toString()));

        const tasks = await Task.find(
            { organization_id: orgId, project_id: projectId, feature_id: { $in: featureIds } },
            { feature_id: 1, status: 1 }
        ).lean();

        const taskCountsByFeature = buildTaskCountsByFeature(tasks);
        const moduleViews = buildFeatureTree(modules, features, taskCountsByFeature);

        return res.status(200).json({
            message: "Version details retrieved successfully",
            success: true,
            project,
            version,
            modules: moduleViews,
        });
    } catch (error) {
        if (error?.message === "FORBIDDEN") return res.status(403).json({ message: "You do not have permission", success: false });
        return res.status(500).json({ message: "Error retrieving version details", error, success: false });
    }
};

export const addTeamToOrg = async (req, res) => {
    const { orgId } = req.params
    const { teamName, members } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(404).json({
            message: "Organization not found",
            success: false
        });
    }
    if (org.owner_id.toString() !== req.user._id) {
        return res.status(403).json({
            message: "You do not have permission to add team to this organization",
            success: false
        })
    }
    const newTeam = new Team({
        name: teamName,
        organization_id: orgId
    })
    for (const member of members) {
        newTeam.members.push({
            user: member.user,
            role: member.role
        })
    }
    await newTeam.save()
    res.status(201).json({
        message: "Team added to organization successfully",
        success: true,
        team: newTeam
    })
}
// export const getSprintWithTeamsAndTasks = async (req, res) => {
//     try {
//         const { sprintId } = req.params;

//         if (!mongoose.Types.ObjectId.isValid(sprintId)) {
//             return res.status(400).json({ message: "Invalid sprint id" });
//         }

//         const sprint = await Sprint.findById(sprintId).lean();

//         if (!sprint) {
//             return res.status(404).json({ message: "Sprint not found" });
//         }

//         // Fetch teams with tasks of this sprint
//         const teams = await Team.aggregate([
//             {
//                 $match: {
//                     organization_id: sprint.organization_id,
//                 },
//             },
//             {
//                 $lookup: {
//                     from: "tasks",
//                     let: { teamId: "$_id" },
//                     pipeline: [
//                         {
//                             $match: {
//                                 $expr: {
//                                     $and: [
//                                         { $eq: ["$team_id", "$$teamId"] },
//                                         { $eq: ["$sprint_id", new mongoose.Types.ObjectId(sprintId)] },
//                                     ],
//                                 },
//                             },
//                         },
//                         {
//                             $populate: {
//                                 path: "assignee",
//                                 select: "name email",
//                             },
//                         },
//                     ],
//                     as: "tasks",
//                 },
//             },
//         ]);

//         return res.status(200).json({
//             sprint,
//             teams,
//         });
//     } catch (error) {
//         console.error("Error fetching sprint data:", error);
//         return res.status(500).json({ message: "Server error" });
//     }
// };

export const getSprintDetails = async (req, res) => {
    try {
        const { sprintId } = req.params;

        // 1. Sprint
        const sprint = await Sprint.findById(sprintId);
        if (!sprint) {
            return res.status(404).json({ message: "Sprint not found" });
        }

        const orgId = sprint.organization_id?.toString();
        if (!orgId) {
            return res.status(400).json({ message: "Sprint has no organization" });
        }
        const projectId = sprint.project_id || null;

        // 2. Teams of same project
        const teams = await Team.find({
            organization_id: sprint.organization_id,
            ...(projectId ? { project_id: projectId } : {}),
        }).populate("members.user", "fullName email");

        // 3. Tasks of this sprint
        const tasks = await Task.find({
            sprint_id: sprintId,
        })
            .populate("assignee", "fullName email");

        // 4. Attach tasks to teams (JS mapping)
        const teamsWithTasks = teams.map(team => ({
            ...team.toObject(),
            tasks: tasks
                .filter((task) => task.team_id?.toString() === team._id.toString())
                .map(serializeTask),
            completed_task: tasks.filter(
                (task) => isTaskDone(task.status) && task.team_id?.toString() === team._id.toString()
            ).length,
        }));

        const orgCtx = await getOrgForMember(orgId, req.user._id);
        const projectCtx = projectId
            ? await getProjectDeliveryAccess(orgId, projectId, req.user._id)
            : null;
        const access = projectCtx?.access || orgCtx.access;
        const deliveryAccess = projectCtx?.deliveryAccess || {
            canWrite: Boolean(orgCtx.isOwner || orgCtx.access?.canWrite),
            readOnly: !(orgCtx.isOwner || orgCtx.access?.canWrite),
            reason: orgCtx.isOwner || orgCtx.access?.canWrite ? null : "Your organization role is view-only.",
        };

        res.status(200).json({
            sprint,
            teams: teamsWithTasks,
            access,
            deliveryAccess,
            workflow: {
                statuses: TASK_STATUSES,
                kanbanColumns: KANBAN_COLUMNS,
            },
        });

    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            message: error.message || "Server error",
            success: false,
        });
    }
};

export const addSprintToOrg = async (req, res) => {
    const { orgId } = req.params
    const { name, startDate, endDate } = req.body
    if (!name || !startDate || !endDate) {
        return res.status(401).json({
            message: "Name start date and End Date are mandatory",
            success: false
        })
    }

    const requestedProjectId = req.params.projectId || req.body.projectId;
    let projectIdToUse = null;

    try {
        if (requestedProjectId) {
            const project = await Project.findOne({ _id: requestedProjectId, organization_id: orgId });
            if (!project) {
                return res.status(404).json({ message: "Project not found", success: false });
            }
            projectIdToUse = requestedProjectId;
            await assertCanWriteProjectDelivery(orgId, projectIdToUse, req.user._id);
        } else {
            await assertCanWriteOrgDelivery(orgId, req.user._id);
        }
        await assertSprintNoOverlap(orgId, projectIdToUse, startDate, endDate);
    } catch (error) {
        return res.status(error.status || 409).json({ message: error.message, success: false });
    }

    const sprint = new Sprint({
        name: name,
        startDate: startDate,
        endDate: endDate,
        organization_id: orgId,
        ...(projectIdToUse ? { project_id: projectIdToUse } : {}),
    })
    await sprint.save()
    res.status(201).json({
        message: "Sprint added successfully",
        success: true,
        sprint: sprint
    })
}

export const editSprintInOrg = async (req, res) => {
    const { orgId, sprintId } = req.params
    const sprint = await Sprint.findById(sprintId)
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const { name, startDate, endDate, isActive } = req.body
    const nextStart = startDate || sprint.startDate
    const nextEnd = endDate || sprint.endDate
    try {
        if (sprint.project_id) await assertCanWriteProjectDelivery(orgId, sprint.project_id, req.user._id);
        else await assertCanWriteOrgDelivery(orgId, req.user._id);
        await assertSprintNoOverlap(orgId, sprint.project_id, nextStart, nextEnd, sprintId);
    } catch (error) {
        return res.status(error.status || 409).json({ message: error.message, success: false });
    }
    if (name) sprint.name = name
    if (startDate) sprint.startDate = startDate
    if (endDate) sprint.endDate = endDate
    if (typeof isActive === 'boolean') sprint.isActive = isActive
    await sprint.save()
    res.status(200).json({
        message: "Sprint updated successfully",
        success: true,
        sprint: sprint
    })
}

export const deleteSprint = async (req, res) => {
    const { orgId, sprintId } = req.params
    const sprint = await Sprint.findOne({
        _id: sprintId,
        organization_id: orgId
    });
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    try {
        if (sprint.project_id) await assertCanWriteProjectDelivery(orgId, sprint.project_id, req.user._id);
        else await assertCanWriteOrgDelivery(orgId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    await Task.deleteMany({ sprint_id: sprintId, organization_id: orgId });
    await sprint.deleteOne()
    res.status(200).json({
        message: "Sprint deleted successfully",
        success: true
    })
}
export const editSprint = async (req, res) => {
    const { orgId, sprintId } = req.params
    const { name, startDate, endDate } = req.body
    const sprint = await Sprint.findOne({
        _id: sprintId,
        organization_id: orgId
    });
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    if (name) sprint.name = name

    const nextStart = startDate || sprint.startDate
    const nextEnd = endDate || sprint.endDate
    try {
        if (sprint.project_id) await assertCanWriteProjectDelivery(orgId, sprint.project_id, req.user._id);
        else await assertCanWriteOrgDelivery(orgId, req.user._id);
        await assertSprintNoOverlap(orgId, sprint.project_id, nextStart, nextEnd, sprintId);
    } catch (error) {
        return res.status(error.status || 409).json({ message: error.message, success: false });
    }
    if (startDate) sprint.startDate = startDate
    if (endDate) sprint.endDate = endDate

    await sprint.save()
    res.status(200).json({
        message: "Sprint edited successfully",
        success: true
    })
}
export const orgTeamCreate = async (req, res) => {
    const { orgId } = req.params
    const { name } = req.body
    if (!name) {
        return res.status(400).json({
            message: "Team name is required",
            success: false
        })
    }

    const requestedProjectId = req.params.projectId || req.body.projectId;
    let projectIdToUse = requestedProjectId;
    if (!projectIdToUse) {
        const defaultProject = await ensureDefaultProjectForOrg(orgId);
        projectIdToUse = defaultProject._id.toString();
    }
    const project = await Project.findOne({ _id: projectIdToUse, organization_id: orgId });
    if (!project) {
        return res.status(404).json({ message: "Project not found", success: false });
    }

    try {
        await assertCanWriteProjectDelivery(orgId, projectIdToUse, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }

    const newTeam = new Team({
        name: name,
        organization_id: orgId,
        project_id: projectIdToUse,
    })
    // for(const member of members){
    //     newTeam.members.push({
    //         user:member.user,
    //         role:member.role
    //     })
    // }
    await newTeam.save()
    res.status(201).json({
        message: "Team created successfully",
        success: true,
        team: newTeam
    })
}
export const orgTeamDelete = async (req, res) => {
    const { orgId, teamId } = req.params
    const projectFilter = req.params.projectId ? { project_id: req.params.projectId } : {};
    const team = await Team.findOne({
        _id: teamId,
        organization_id: orgId,
        ...projectFilter,
    })
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    try {
        await assertCanWriteProjectDelivery(orgId, team.project_id, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    await team.deleteOne();
    await Task.deleteMany({ team_id: teamId, organization_id: orgId });
    // for(const member of members){
    //     newTeam.members.push({
    //         user:member.user,
    //         role:member.role
    //     })
    // }
    // await newTeam.save()
    res.status(201).json({
        message: "Team deleted successfully",
        success: true,
        // team: newTeam
    })
}
export const orgMemberAddToTeam = async (req, res) => {
    const { orgId, teamId } = req.params
    let org;
    try {
        ({ org } = await getOrgForMember(orgId, req.user._id));
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    const team = await Team.findOne({
        organization_id: orgId,
        _id: teamId
    })
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    try {
        await assertCanWriteProjectDelivery(orgId, team.project_id, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    const { user, role } = req.body
    const usr = await User.findById(user)
    if (!usr) {
        return res.status(403).json({
            message: "User is not valid",
            success: false
        })
    }
    const orgMember = org.members.some(m => m.user.toString() === user)
    if (!orgMember) {
        return res.status(403).json({
            message: "Member is not a valid member for this organization",
            success: false
        })
    }
    const isAlreadyMember = team.members.some(m => m.user.toString() === user)
    if (isAlreadyMember) {
        return res.status(400).json({
            message: "Member is already in the team",
            success: false
        })
    }
    team.members.push({
        user: user,
        role: role
    })
    await team.save()
    res.status(200).json({
        message: "Member added to team",
        success: true,
        team: team
    })
}
export const orgMemberRemoveFromTeam = async (req, res) => {
    const { orgId, teamId, memberId } = req.params
    let org;
    try {
        ({ org } = await getOrgForMember(orgId, req.user._id));
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    const team = await Team.findOne({
        organization_id: orgId,
        _id: teamId
    })
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    try {
        await assertCanWriteProjectDelivery(orgId, team.project_id, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    // const { user, role } = req.body
    const usr = await User.findById(memberId)
    if (!usr) {
        return res.status(403).json({
            message: "User is not valid",
            success: false
        })
    }
    const orgMember = org.members.some(m => m.user.toString() === memberId)
    if (!orgMember) {
        return res.status(403).json({
            message: "Member is not a valid member for this organization",
            success: false
        })
    }
    const isMemberInTeam = team.members.some(m => m.user.toString() === memberId)
    if (!isMemberInTeam) {
        return res.status(400).json({
            message: "Member is not in the team",
            success: false
        })
    }
    team.members = team.members.filter(m => m.user.toString() !== memberId)
    await team.save()
    res.status(200).json({
        message: "Member removed from team",
        success: true,
        team: team
    })
}
export const orgTeamFetchAll = async (req, res) => {
    const { orgId } = req.params
    try {
        await getOrgForMember(orgId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({
            message: error.message || "You are not authorized to view teams of this organization",
            success: false
        })
    }
    const requestedProjectId = req.params.projectId || req.query?.projectId;
    const filter = { organization_id: orgId };
    if (requestedProjectId) {
        const project = await Project.findOne({ _id: requestedProjectId, organization_id: orgId }).lean();
        if (!project) {
            return res.status(404).json({ message: "Project not found", success: false });
        }
        filter.project_id = requestedProjectId;
    }

    const teams = await Team.find(filter).populate('members.user', '-password')
    res.status(200).json({
        message: "Teams fetched successfully",
        success: true,
        teams: teams
    })
}
export const orgTeamFetchOne = async (req, res) => {
    const { orgId, teamId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to view teams of this organization",
            success: false
        })
    }
    const requestedProjectId = req.params.projectId || req.query?.projectId;
    const projectFilter = requestedProjectId ? { project_id: requestedProjectId } : {};
    const team = await Team.findOne({ _id: teamId, organization_id: orgId, ...projectFilter }).populate('members.user', '-password')
    if (!team) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    res.status(200).json({
        message: "Team fetched successfully",
        success: true,
        team: team
    })
}
export const orgAddTaskToTeamInSprint = async (req, res) => {
    const { orgId, sprintId } = req.params
    const {
        team,
        name,
        description,
        status,
        priority,
        startDate,
        endDate,
        members,
        featureId,
        projectId,
        task_type,
        blocked_reason,
        acceptance_criteria,
    } = req.body
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const taskProjectId = projectId || sprint.project_id;
    if (!taskProjectId) {
        return res.status(400).json({ message: "Project is required for a task", success: false });
    }
    const project = await Project.findOne({ _id: taskProjectId, organization_id: orgId });
    if (!project) {
        return res.status(404).json({ message: "Project not found", success: false });
    }
    try {
        await assertCanWriteProjectDelivery(orgId, taskProjectId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    const teamObj = await Team.findOne({
        _id: team,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    if (teamObj.project_id?.toString() !== taskProjectId?.toString()) {
        return res.status(400).json({
            message: "Team does not belong to this project",
            success: false,
        });
    }
    for (const member of members || []) {
        const isMemberInTeam = teamObj.members.some(mem => mem.user._id.toString() === member)
        if (!isMemberInTeam) {
            return res.status(400).json({
                message: `Member with id ${member} is not in the team`,
                success: false
            })
        }
    }

    let featureDoc = null;
    if (featureId) {
        featureDoc = await Feature.findOne({ _id: featureId, organization_id: orgId, project_id: taskProjectId });
        if (!featureDoc) {
            return res.status(400).json({
                message: "Invalid feature for this project",
                success: false
            });
        }
    }
    const newTask = new Task({
        title: name,
        description,
        status: resolveTaskStatusForWrite(status || "Pending"),
        task_type: TASK_TYPES.includes(task_type) ? task_type : "feature",
        priority: TASK_PRIORITIES.includes(priority) ? priority : "Medium",
        blocked_reason: (blocked_reason || "").trim(),
        acceptance_criteria: (acceptance_criteria || "").trim(),
        startDate,
        endDate,
        sprint_id: sprintId,
        team_id: team,
        project_id: taskProjectId,
        organization_id: orgId,
        feature_id: featureDoc?._id || null,
    })
    for (const member of members || []) {
        newTask.assignee.push(member)
    }
    await newTask.save()
    res.status(201).json({
        message: "Task added to team in sprint successfully",
        success: true,
        task: serializeTask(newTask)
    })
}
export const orgShowSingleTaskInSprint = async (req, res) => {
    const { orgId, sprintId, taskId } = req.params
    try {
        await getOrgForMember(orgId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({
            message: error.message || "You are not authorized to view task of this organization",
            success: false
        })
    }
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        organization_id: orgId
    }).populate('assignee', '-password').populate('team_id', '-organization_id').populate('feature_id')
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    res.status(200).json({
        message: "Task fetched successfully",
        success: true,
        task: serializeTask(task)
    })
}
export const orgPatchTaskStatus = async (req, res) => {
    const { orgId, sprintId, taskId } = req.params;
    const { status, blocked_reason } = req.body;

    try {
        const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId });
        if (!sprint) {
            return res.status(404).json({ message: "Sprint not found", success: false });
        }

        const task = await Task.findOne({
            _id: taskId,
            sprint_id: sprintId,
            organization_id: orgId,
        }).populate("assignee", "_id");

        if (!task) {
            return res.status(404).json({ message: "Task not found", success: false });
        }
        if (task.project_id) await assertCanWriteProjectDelivery(orgId, task.project_id, req.user._id);
        else await assertCanWriteOrgDelivery(orgId, req.user._id);

        const nextStatus = resolveTaskStatusForWrite(status);
        assertTaskTransition(task.status, nextStatus);

        task.status = nextStatus;
        if (nextStatus === "Blocked") {
            task.blocked_reason = (blocked_reason || task.blocked_reason || "").trim();
        } else {
            task.blocked_reason = "";
        }

        await task.save();

        return res.status(200).json({
            message: "Task status updated",
            success: true,
            task: serializeTask(task),
        });
    } catch (error) {
        const code = error.status || 500;
        return res.status(code).json({
            message: error.message || "Failed to update task status",
            success: false,
        });
    }
};

export const orgEditTaskToTeamInSprint = async (req, res) => {
    const { orgId, sprintId, taskId } = req.params
    const {
        team,
        name,
        description,
        status,
        priority,
        startDate,
        endDate,
        members,
        featureId,
        projectId,
        task_type,
        blocked_reason,
        acceptance_criteria,
    } = req.body
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        organization_id: orgId
    })
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    const taskProjectId = projectId || task.project_id || sprint.project_id;
    if (!taskProjectId) {
        return res.status(400).json({ message: "Project is required for a task", success: false });
    }
    const project = await Project.findOne({ _id: taskProjectId, organization_id: orgId });
    if (!project) {
        return res.status(404).json({ message: "Project not found", success: false });
    }
    try {
        await assertCanWriteProjectDelivery(orgId, taskProjectId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    const teamObj = await Team.findOne({
        _id: team,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    if (teamObj.project_id?.toString() !== taskProjectId?.toString()) {
        return res.status(400).json({
            message: "Team does not belong to this project",
            success: false,
        });
    }
    for (const member of members || []) {
        const isMemberInTeam = teamObj.members.some(mem => mem.user._id.toString() === member)
        if (!isMemberInTeam) {
            return res.status(400).json({
                message: `Member with id ${member} is not in the team`,
                success: false
            })
        }
    }
    task.title = name || task.title
    task.description = description ?? task.description
    if (status) {
        const nextStatus = resolveTaskStatusForWrite(status);
        assertTaskTransition(task.status, nextStatus);
        task.status = nextStatus;
    }
    if (priority && TASK_PRIORITIES.includes(priority)) task.priority = priority
    if (task_type && TASK_TYPES.includes(task_type)) task.task_type = task_type
    if (blocked_reason !== undefined) task.blocked_reason = (blocked_reason || "").trim()
    if (acceptance_criteria !== undefined) task.acceptance_criteria = (acceptance_criteria || "").trim()
    task.startDate = startDate || task.startDate
    task.endDate = endDate || task.endDate
    task.assignee = []
    for (const member of members || []) {
        task.assignee.push(member)
    }
    task.team_id = team;
    task.project_id = taskProjectId;

    if (featureId === "" || featureId === null) {
        task.feature_id = null;
    } else if (typeof featureId === "string" && featureId) {
        const featureDoc = await Feature.findOne({ _id: featureId, organization_id: orgId, project_id: taskProjectId });
        if (!featureDoc) {
            return res.status(400).json({ message: "Invalid feature for this project", success: false });
        }
        task.feature_id = featureDoc._id;
    }

    await task.save()
    res.status(201).json({
        message: "Task edited successfully",
        success: true,
        task: serializeTask(task)
    })
}
export const orgDeleteTaskFromTeamInSprint = async (req, res) => {
    const { orgId, sprintId, taskId, teamId } = req.params
    const sprint = await Sprint.findOne({ _id: sprintId, organization_id: orgId })
    if (!sprint) {
        return res.status(404).json({
            message: "Sprint not found",
            success: false
        })
    }
    const teamObj = await Team.findOne({
        _id: teamId,
        organization_id: orgId
    }).populate('members.user', '-password')
    if (!teamObj) {
        return res.status(404).json({
            message: "Team not found",
            success: false
        })
    }
    const task = await Task.findOne({
        _id: taskId,
        sprint_id: sprintId,
        team_id: teamId,
        organization_id: orgId
    })
    if (!task) {
        return res.status(404).json({
            message: "Task not found",
            success: false
        })
    }
    if (task.project_id && teamObj.project_id?.toString() !== task.project_id?.toString()) {
        return res.status(400).json({
            message: "Team does not belong to this task project",
            success: false,
        });
    }
    try {
        if (task.project_id) await assertCanWriteProjectDelivery(orgId, task.project_id, req.user._id);
        else await assertCanWriteOrgDelivery(orgId, req.user._id);
    } catch (error) {
        return res.status(error.status || 403).json({ message: error.message, success: false });
    }
    await task.deleteOne()
    res.status(201).json({
        message: "Task deleted from team in sprint successfully",
        success: true,
        // task: task
    })
}

// content planner 
export const orgAddPlatformInSprint = async (req, res) => {
    const { orgId } = req.params
    const { name } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }


    const newPlatform = new Platform({
        name: name,
        organization_id: orgId
    })

    await newPlatform.save()
    res.status(201).json({
        message: "Platform added successfully",
        success: true,
        platform: newPlatform
    })
}

export const orgAddPlatformStatus = async (req, res) => {
    const { orgId, platformId } = req.params
    const { name } = req.body
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const platform = await Platform.findById(platformId)
    if (!platform) {
        return res.status(403).json({
            message: "Platform not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    const newStatus = new PlatformStatus({
        name
    });
    await newStatus.save();

    // 5. Push the new status ID to the platform and save
    platform.status.push(newStatus._id);
    await platform.save();
    res.status(201).json({
        message: "Platform status added successfully",
        success: true,
        // platform: newPlatform
    })
}

export const orgShowPlatformDetails = async (req, res) => {
    const { orgId, platformId } = req.params
    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const platform = await Platform.findById(platformId).populate("status")
    if (!platform) {
        return res.status(403).json({
            message: "Platform not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    res.status(201).json({
        message: "Platform retreive successfully",
        success: true,
        platform: platform
    })
}


export const orgAddPlatformPost = async (req, res) => {
    const { orgId, platformId, sprintId } = req.params
    const {name, description, status, priority, postingDate} = req.body

    const org = await Organization.findById(orgId)
    if (!org) {
        return res.status(403).json({
            message: "Org not found",
            success: false
        })
    }
    const platform = await Platform.findById(platformId)
    if (!platform) {
        return res.status(403).json({
            message: "Platform not found",
            success: false
        })
    }
    const sprint = await Sprint.findById(sprintId)
    if (!sprint) {
        return res.status(403).json({
            message: "Sprint not found",
            success: false
        })
    }
    const isMember = org.owner_id.toString() === req.user._id
    if (!isMember) {
        return res.status(403).json({
            message: "You are not authorized to add task to this organization",
            success: false
        })
    }
    const newPost = new Post({
        title: name,
        description,
        status,
        priority,
        postingDate,
        sprint_id: sprintId,
        organization_id: orgId,
        platformId : platformId
    });
    await newPost.save();
    res.status(201).json({
        message: "Platform status added successfully",
        success: true,
        // platform: newPlatform
    })
}
