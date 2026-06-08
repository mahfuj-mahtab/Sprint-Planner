import Organization from "../models/organization.models.js";
import Client from "../models/client.models.js";
import Project from "../models/project.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import Sprint from "../models/sprint.models.js";
import Task from "../models/task.models.js";
import Team from "../models/team.models.js";
import Feature from "../models/feature.models.js";
import FeatureModule from "../models/featureModule.models.js";
import ProjectVersion from "../models/projectVersion.models.js";
import {
  getClientPortalContext,
  assertClientCanAccessProject,
  resolveClientPortalAccess,
  findPortalOrgsForUser,
} from "../utils/clientPortal.js";
import { buildClientDetailSummary } from "../utils/crmMetrics.js";
import { isTaskDone } from "../utils/taskWorkflow.js";
import { normalizeProjectStatus } from "../constants/projectWorkflow.js";
import { PROJECT_STATUS_LABELS } from "../constants/projectWorkflow.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const sanitizeProject = (p) => {
  const obj = p.toObject ? p.toObject() : { ...p };
  obj.status = normalizeProjectStatus(obj.status);
  obj.status_label = PROJECT_STATUS_LABELS[obj.status] || obj.status;
  return obj;
};

const sanitizeTask = (t) => ({
  _id: t._id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  task_type: t.task_type,
  startDate: t.startDate,
  endDate: t.endDate,
  assignee: (t.assignee || []).map((a) => ({
    _id: a._id,
    fullName: a.fullName || "Team member",
  })),
});

export const portalListOrgs = async (req, res) => {
  try {
    const orgs = await findPortalOrgsForUser(req.user);
    const portals = [];
    for (const org of orgs) {
      const membership = await resolveClientPortalAccess(org, req.user._id, req.user.email, {
        sync: true,
      });
      if (!membership) continue;
      const accounts = await Client.find({ _id: { $in: membership.accountIds } }).select(
        "name company email"
      );
      portals.push({
        org_id: org._id,
        org_name: org.name,
        client_account: accounts[0] || null,
        client_accounts: accounts,
      });
    }
    return res.status(200).json({ success: true, portals });
  } catch (error) {
    return handleError(res, error);
  }
};

export const portalOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    const ctx = await getClientPortalContext(orgId, req.user._id, req.user.email);
    const scopeOids = ctx.clientScopeIds;

    const [projects, incomes, childClients] = await Promise.all([
      Project.find({ organization_id: orgId, client_id: { $in: scopeOids }, isArchived: false })
        .populate("client_id", "name company parent_client_id")
        .sort({ updatedAt: -1 }),
      IncomeTransaction.find({ organization_id: orgId, client_id: { $in: scopeOids } })
        .sort({ payment_date: -1 })
        .populate("project_id", "name")
        .populate("client_id", "name company"),
      Client.find({ organization_id: orgId, parent_client_id: ctx.accountClient._id }).select(
        "name company status"
      ),
    ]);

    const summary = buildClientDetailSummary(ctx.accountClient, projects, incomes);

    return res.status(200).json({
      success: true,
      org: { _id: ctx.org._id, name: ctx.org.name },
      account_client: ctx.accountClient,
      linked_clients: childClients,
      access: ctx.access,
      summary,
      projects: projects.map(sanitizeProject),
      recent_payments: incomes.slice(0, 20).map((i) => ({
        _id: i._id,
        amount: i.amount,
        payment_date: i.payment_date,
        payment_method: i.payment_method,
        notes: i.notes,
        project: i.project_id,
        client: i.client_id,
      })),
      all_payments: incomes.map((i) => ({
        _id: i._id,
        amount: i.amount,
        payment_date: i.payment_date,
        payment_method: i.payment_method,
        notes: i.notes,
        project: i.project_id,
        client: i.client_id,
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const portalProjectDetails = async (req, res) => {
  const { orgId, projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, organization_id: orgId }).populate(
      "client_id",
      "name company parent_client_id"
    );
    if (!project) {
      return res.status(404).json({ message: "Project not found", success: false });
    }

    await assertClientCanAccessProject(orgId, req.user._id, project, req.user.email);

    const [sprints, teams, tasks, modules, features, versions, incomes] = await Promise.all([
      Sprint.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: -1 }),
      Team.find({ organization_id: orgId, project_id: projectId }).select("name"),
      Task.find({ organization_id: orgId, project_id: projectId })
        .populate("assignee", "fullName")
        .populate("sprint_id", "name startDate endDate isActive")
        .populate("feature_id", "name status")
        .lean(),
      FeatureModule.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 }),
      Feature.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: 1 }),
      ProjectVersion.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: -1 }),
      IncomeTransaction.find({ organization_id: orgId, project_id: projectId }).sort({
        payment_date: -1,
      }),
    ]);

    const sprintDetails = sprints.map((s) => {
      const sprintTasks = tasks.filter((t) => t.sprint_id?._id?.toString() === s._id.toString());
      return {
        sprint: s,
        total_tasks: sprintTasks.length,
        completed_tasks: sprintTasks.filter((t) => isTaskDone(t.status)).length,
      };
    });

    const tasksByStatus = tasks.reduce((acc, t) => {
      const s = t.status || "Pending";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const totalPaid = incomes.reduce((s, i) => s + Number(i.amount), 0);

    return res.status(200).json({
      success: true,
      project: sanitizeProject(project),
      sprints,
      sprintDetails,
      teams,
      tasks: tasks.map(sanitizeTask),
      tasksByStatus,
      modules,
      features,
      versions,
      payments: incomes.map((i) => ({
        _id: i._id,
        amount: i.amount,
        payment_date: i.payment_date,
        payment_method: i.payment_method,
        notes: i.notes,
      })),
      summary: {
        totalPaid,
        paymentCount: incomes.length,
        taskCount: tasks.length,
        completedTasks: tasks.filter((t) => isTaskDone(t.status)).length,
        featureCount: features.length,
        versionCount: versions.length,
      },
      readOnly: true,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const portalSprintDetails = async (req, res) => {
  const { orgId, projectId, sprintId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, organization_id: orgId });
    if (!project) {
      return res.status(404).json({ message: "Project not found", success: false });
    }
    await assertClientCanAccessProject(orgId, req.user._id, project, req.user.email);

    const sprint = await Sprint.findOne({
      _id: sprintId,
      organization_id: orgId,
      project_id: projectId,
    });
    if (!sprint) {
      return res.status(404).json({ message: "Sprint not found", success: false });
    }

    const teams = await Team.find({ organization_id: orgId, project_id: projectId, sprint_id: sprintId });
    const teamIds = teams.map((t) => t._id);
    const tasks = await Task.find({
      organization_id: orgId,
      sprint_id: sprintId,
      team_id: { $in: teamIds },
    })
      .populate("assignee", "fullName")
      .lean();

    const teamsWithTasks = teams.map((team) => ({
      _id: team._id,
      name: team.name,
      tasks: tasks
        .filter((t) => t.team_id?.toString() === team._id.toString())
        .map(sanitizeTask),
    }));

    return res.status(200).json({
      success: true,
      sprint,
      teams: teamsWithTasks,
      readOnly: true,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
