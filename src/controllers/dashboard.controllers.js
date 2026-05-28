import Organization from "../models/organization.models.js";
import Project from "../models/project.models.js";
import Sprint from "../models/sprint.models.js";
import Task from "../models/task.models.js";
import Team from "../models/team.models.js";
import Client from "../models/client.models.js";
import Feature from "../models/feature.models.js";
import FeatureModule from "../models/featureModule.models.js";
import ProjectVersion from "../models/projectVersion.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import Partition from "../models/partition.models.js";
import { getOrgForMember } from "../utils/orgAccess.js";
import { canViewProject } from "../utils/projectAccess.js";
import { loadUserProjectTeamIds } from "../utils/teamAccess.js";
import { ensureDefaultCategories } from "./finance.controllers.js";
import { sumByProjectId } from "../utils/mongoIds.js";
import {
  buildPartitionScopeMap,
  sumIncomeAllocationsForScopes,
  sumBalancesByScope,
} from "../utils/partitionFinance.js";
import { effectivePartitionScope } from "../constants/partitionScopes.js";
import { pickCurrentVersion } from "../utils/versionRules.js";
import { bucketTaskForMetrics, isTaskDone, isTaskTerminal } from "../utils/taskWorkflow.js";

const monthKey = (d) => {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const lastNMonths = (n) => {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(monthKey(d));
  }
  return out;
};

const countTasksByStatus = (tasks) => {
  const out = { total: tasks.length, completed: 0, pending: 0, wip: 0, hold: 0, cancelled: 0, inReview: 0 };
  for (const t of tasks) {
    const bucket = bucketTaskForMetrics(t.status);
    if (bucket === "completed") out.completed++;
    else if (bucket === "wip") out.wip++;
    else if (bucket === "blocked") out.hold++;
    else if (bucket === "cancelled") out.cancelled++;
    else out.pending++;
    if (bucket === "wip" && t.status && String(t.status).includes("Review")) out.inReview++;
  }
  out.completionPct = out.total ? Math.round((out.completed / out.total) * 100) : 0;
  return out;
};

const countTasksByPriority = (tasks) => {
  const out = { High: 0, Medium: 0, Low: 0 };
  for (const t of tasks) {
    if (out[t.priority] !== undefined) out[t.priority]++;
  }
  return out;
};

const buildMemberWorkload = (tasks, rosterMembers = []) => {
  const byUser = {};
  for (const m of rosterMembers) {
    const id = String(m.user?._id || m.user);
    byUser[id] = {
      userId: id,
      name: m.user?.fullName || "Unknown",
      role: m.role || null,
      total: 0,
      completed: 0,
      wip: 0,
      pending: 0,
      hold: 0,
      cancelled: 0,
    };
  }
  for (const task of tasks) {
    const assignees = task.assignee?.length ? task.assignee : [];
    for (const user of assignees) {
      const id = String(user._id || user);
      if (!byUser[id]) {
        byUser[id] = {
          userId: id,
          name: user.fullName || "Unknown",
          role: null,
          total: 0,
          completed: 0,
          wip: 0,
          pending: 0,
          hold: 0,
          cancelled: 0,
        };
      }
      byUser[id].total++;
      const bucket = bucketTaskForMetrics(task.status);
      if (bucket === "completed") byUser[id].completed++;
      else if (bucket === "wip") byUser[id].wip++;
      else if (bucket === "blocked") byUser[id].hold++;
      else if (bucket === "cancelled") byUser[id].cancelled++;
      else byUser[id].pending++;
    }
  }
  return Object.values(byUser)
    .map((r) => ({
      ...r,
      completionPct: r.total ? Math.round((r.completed / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
};

export const projectDashboard = async (req, res) => {
  const { orgId, projectId } = req.params;

  try {
    const { isOwner, access } = await getOrgForMember(orgId, req.user._id);

    const project = await Project.findOne({ _id: projectId, organization_id: orgId }).populate(
      "client_id",
      "name company email"
    );
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

    const pid = projectId.toString();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [sprints, teams, tasks, features, modules, versions, incomes, expenses, partitions] =
      await Promise.all([
      Sprint.find({ organization_id: orgId, project_id: projectId }).sort({ createdAt: -1 }),
      Team.find({ organization_id: orgId, project_id: projectId }).populate("members.user", "fullName email"),
      Task.find({ organization_id: orgId, project_id: projectId })
        .populate("assignee", "fullName email")
        .populate("sprint_id", "name startDate endDate isActive")
        .lean(),
      Feature.find({ organization_id: orgId, project_id: projectId }),
      FeatureModule.find({ organization_id: orgId, project_id: projectId }),
      ProjectVersion.find({ organization_id: orgId, project_id: projectId }),
      IncomeTransaction.find({ organization_id: orgId }),
      ExpenseTransaction.find({ organization_id: orgId }),
      Partition.find({ organization_id: orgId }),
    ]);

    const scopeMap = buildPartitionScopeMap(partitions);
    const businessPartitionIds = new Set(
      partitions.filter((p) => effectivePartitionScope(p) === "business").map((p) => p._id.toString())
    );

    const projectIncomes = incomes.filter((i) => i.project_id?.toString() === pid);
    const projectExpenses = expenses.filter(
      (e) =>
        e.project_id?.toString() === pid &&
        businessPartitionIds.has(e.partition_id?.toString())
    );
    const revenue = projectIncomes.reduce(
      (s, i) => s + sumIncomeAllocationsForScopes(i, scopeMap, ["business"]),
      0
    );
    const cost = projectExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const monthIncome = projectIncomes
      .filter((i) => i.payment_date >= monthStart && i.payment_date <= monthEnd)
      .reduce((s, i) => s + sumIncomeAllocationsForScopes(i, scopeMap, ["business"]), 0);
    const monthExpense = projectExpenses
      .filter((e) => e.expense_date >= monthStart && e.expense_date <= monthEnd)
      .reduce((s, e) => s + Number(e.amount), 0);

    const tasksSummary = countTasksByStatus(tasks);
    const priority = countTasksByPriority(tasks);
    const unassigned = tasks.filter((t) => !t.assignee?.length).length;

    const overdue = tasks.filter((t) => {
      if (!t.endDate || isTaskTerminal(t.status)) return false;
      const end = new Date(t.endDate);
      end.setHours(23, 59, 59, 999);
      return end < now;
    }).length;

    const dueSoon = tasks.filter((t) => {
      if (!t.endDate || isTaskTerminal(t.status)) return false;
      const end = new Date(t.endDate);
      const limit = new Date();
      limit.setDate(limit.getDate() + 3);
      return end >= now && end <= limit;
    }).length;

    const featureTaskMap = new Map();
    for (const t of tasks.filter((task) => task.feature_id)) {
      const key = t.feature_id.toString();
      const prev = featureTaskMap.get(key) || { total: 0, completed: 0 };
      prev.total++;
      if (isTaskDone(t.status)) prev.completed++;
      featureTaskMap.set(key, prev);
    }
    let featuresCompleted = 0;
    let featuresInProgress = 0;
    let featuresPending = 0;
    for (const f of features) {
      const c = featureTaskMap.get(f._id.toString()) || { total: 0, completed: 0 };
      if (c.total && c.completed >= c.total) featuresCompleted++;
      else if (c.completed > 0) featuresInProgress++;
      else featuresPending++;
    }

    const currentVersion = pickCurrentVersion(versions);
    const memberWorkload = buildMemberWorkload(tasks, teams.flatMap((t) => t.members || []));

    const uniqueMemberIds = new Set();
    teams.forEach((team) => {
      (team.members || []).forEach((m) => {
        const id = m.user?._id || m.user;
        if (id) uniqueMemberIds.add(String(id));
      });
    });

    const sprintStats = sprints.map((sprint) => {
      const sprintTasks = tasks.filter(
        (t) => t.sprint_id && (t.sprint_id._id?.toString() || t.sprint_id.toString()) === sprint._id.toString()
      );
      const stats = countTasksByStatus(sprintTasks);
      return {
        sprint: {
          _id: sprint._id,
          name: sprint.name,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          isActive: sprint.isActive,
        },
        ...stats,
      };
    });

    const teamStats = teams.map((team) => {
      const teamTasks = tasks.filter((t) => t.team_id?.toString() === team._id.toString());
      const stats = countTasksByStatus(teamTasks);
      return {
        team: { _id: team._id, name: team.name },
        memberCount: (team.members || []).length,
        members: buildMemberWorkload(teamTasks, team.members || []),
        ...stats,
      };
    });

    const linkedFeatureTasks = tasks.filter((t) => t.feature_id).length;

    return res.status(200).json({
      message: "Project dashboard retrieved",
      success: true,
      dashboard: {
        project: {
          _id: project._id,
          name: project.name,
          description: project.description,
          status: project.status,
          project_type: project.project_type,
          budget: project.budget,
          client: project.client_id
            ? {
                _id: project.client_id._id,
                name: project.client_id.name,
                company: project.client_id.company,
              }
            : null,
        },
        currentVersion: currentVersion
          ? {
              _id: currentVersion._id,
              name: currentVersion.name,
              status: currentVersion.status,
              start_date: currentVersion.start_date,
              end_date: currentVersion.end_date,
            }
          : null,
        finance: {
          revenue,
          cost,
          profit: revenue - cost,
          monthIncome,
          monthExpense,
          monthProfit: monthIncome - monthExpense,
        },
        access,
        counts: {
          sprints: sprints.length,
          activeSprints: sprints.filter((s) => s.isActive).length,
          teams: teams.length,
          members: uniqueMemberIds.size,
          features: features.length,
          modules: modules.length,
          versions: versions.length,
        },
        tasks: {
          ...tasksSummary,
          unassigned,
          overdue,
          dueSoon,
          priority,
          linkedToFeatures: linkedFeatureTasks,
        },
        features: {
          total: features.length,
          modules: modules.length,
          completed: featuresCompleted,
          inProgress: featuresInProgress,
          pending: featuresPending,
        },
        sprints: sprintStats,
        teams: teamStats,
        members: memberWorkload,
        atRiskTasks: tasks
          .filter((t) => {
            if (!t.endDate || isTaskTerminal(t.status)) return false;
            const end = new Date(t.endDate);
            end.setHours(23, 59, 59, 999);
            const limit = new Date();
            limit.setDate(limit.getDate() + 3);
            return end < now || (end >= now && end <= limit);
          })
          .slice(0, 30)
          .map((t) => ({
            _id: t._id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            endDate: t.endDate,
            sprintName: t.sprint_id?.name || null,
            assignees: (t.assignee || []).map((u) => u.fullName).filter(Boolean),
            isOverdue:
              t.endDate && !isTaskTerminal(t.status) && new Date(t.endDate) < now,
          })),
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      message: error.message || "Failed to load project dashboard",
      success: false,
    });
  }
};

export const orgDashboard = async (req, res) => {
  const { orgId } = req.params;

  try {
    const { org, isOwner, access } = await getOrgForMember(orgId, req.user._id);
    await ensureDefaultCategories(orgId);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const months = lastNMonths(6);

    const [
      projects,
      tasks,
      sprints,
      clientsCount,
      features,
      incomes,
      expenses,
      partitions,
    ] = await Promise.all([
      Project.find({ organization_id: orgId, isArchived: false }).sort({ createdAt: -1 }).lean(),
      Task.find({ organization_id: orgId }),
      Sprint.find({ organization_id: orgId }),
      Client.countDocuments({ organization_id: orgId }),
      Feature.find({ organization_id: orgId }),
      IncomeTransaction.find({ organization_id: orgId }),
      ExpenseTransaction.find({ organization_id: orgId }),
      Partition.find({ organization_id: orgId }),
    ]);

    const visibleProjects = projects.filter((p) => canViewProject(p, req.user._id, isOwner));

    const scopeMap = buildPartitionScopeMap(partitions);
    const businessPartitionIds = new Set(
      partitions.filter((p) => effectivePartitionScope(p) === "business").map((p) => p._id.toString())
    );
    const balanceByScope = sumBalancesByScope(partitions);
    const totalBalance = balanceByScope.all;

    const businessIncomes = incomes.map((i) => ({
      ...i.toObject(),
      businessAmount: sumIncomeAllocationsForScopes(i, scopeMap, ["business"]),
    }));
    const businessExpenses = expenses.filter((e) =>
      businessPartitionIds.has(e.partition_id?.toString())
    );

    const monthIncome = businessIncomes
      .filter((i) => i.payment_date >= monthStart && i.payment_date <= monthEnd)
      .reduce((s, i) => s + Number(i.businessAmount), 0);
    const monthExpense = businessExpenses
      .filter((e) => e.expense_date >= monthStart && e.expense_date <= monthEnd)
      .reduce((s, e) => s + Number(e.amount), 0);
    const allTimeIncome = businessIncomes.reduce((s, i) => s + Number(i.businessAmount), 0);
    const allTimeExpense = businessExpenses.reduce((s, e) => s + Number(e.amount), 0);

    const monthlyTrend = months.map((key) => {
      const [y, m] = key.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0, 23, 59, 59, 999);
      const income = businessIncomes
        .filter((i) => i.payment_date >= start && i.payment_date <= end)
        .reduce((s, i) => s + Number(i.businessAmount), 0);
      const expense = businessExpenses
        .filter((e) => e.expense_date >= start && e.expense_date <= end)
        .reduce((s, e) => s + Number(e.amount), 0);
      return { month: key, label: start.toLocaleString("en", { month: "short" }), income, expense, profit: income - expense };
    });

    const incomeByCategoryMap = {};
    for (const i of businessIncomes) {
      const amt = Number(i.businessAmount);
      if (!amt) continue;
      const c = i.category || "Other";
      incomeByCategoryMap[c] = (incomeByCategoryMap[c] || 0) + amt;
    }
    const expenseByCategoryMap = {};
    for (const e of businessExpenses) {
      const c = e.category || "Other";
      expenseByCategoryMap[c] = (expenseByCategoryMap[c] || 0) + Number(e.amount);
    }

    const businessIncomesForProjects = businessIncomes
      .filter((i) => i.project_id && i.businessAmount > 0)
      .map((i) => ({ project_id: i.project_id, amount: i.businessAmount }));
    const revenueMap = sumByProjectId(businessIncomesForProjects);
    const costMap = sumByProjectId(
      businessExpenses.filter((e) => e.project_id)
    );

    const tasksByProject = {};
    for (const t of tasks) {
      const pid = t.project_id?.toString() || "unassigned";
      if (!tasksByProject[pid]) {
        tasksByProject[pid] = { total: 0, completed: 0, pending: 0, wip: 0, hold: 0, cancelled: 0 };
      }
      tasksByProject[pid].total++;
      const bucket = bucketTaskForMetrics(t.status);
      if (bucket === "completed") tasksByProject[pid].completed++;
      else if (bucket === "wip") tasksByProject[pid].wip++;
      else if (bucket === "blocked") tasksByProject[pid].hold++;
      else if (bucket === "cancelled") tasksByProject[pid].cancelled++;
      else tasksByProject[pid].pending++;
    }

    const projectStats = visibleProjects.map((p) => {
      const pid = p._id.toString();
      const ts = tasksByProject[pid] || { total: 0, completed: 0, pending: 0, wip: 0, hold: 0, cancelled: 0 };
      const projectSprints = sprints.filter((s) => s.project_id?.toString() === pid);
      const activeSprints = projectSprints.filter((s) => s.isActive).length;
      const revenue = revenueMap[pid] || 0;
      const cost = costMap[pid] || 0;
      return {
        project: { _id: p._id, name: p.name, status: p.status, project_type: p.project_type },
        revenue,
        cost,
        profit: revenue - cost,
        tasks: ts,
        completionPct: ts.total ? Math.round((ts.completed / ts.total) * 100) : 0,
        sprintCount: projectSprints.length,
        activeSprints,
      };
    });

    const taskStatus = countTasksByStatus(tasks);
    taskStatus.completionPct = taskStatus.total
      ? Math.round((taskStatus.completed / taskStatus.total) * 100)
      : 0;

    const featureStats = {
      total: features.length,
      completed: 0,
      inProgress: 0,
      pending: 0,
    };
    for (const f of features) {
      const featTasks = tasks.filter((t) => t.feature_id?.toString() === f._id.toString());
      const total = featTasks.length;
      const completed = featTasks.filter((t) => isTaskDone(t.status)).length;
      if (total && completed >= total) featureStats.completed++;
      else if (completed > 0) featureStats.inProgress++;
      else featureStats.pending++;
    }

    return res.status(200).json({
      message: "Dashboard data retrieved",
      success: true,
      dashboard: {
        access,
        organization: { _id: org._id, name: org.name },
        finance: {
          monthIncome,
          monthExpense,
          netProfit: monthIncome - monthExpense,
          allTimeIncome,
          allTimeExpense,
          allTimeProfit: allTimeIncome - allTimeExpense,
          periodLabel: monthStart.toLocaleString("en", { month: "long", year: "numeric" }),
          totalBalance,
          businessBalance: balanceByScope.business,
          ownerBalance: balanceByScope.owner,
          monthlyTrend,
          incomeByCategory: Object.entries(incomeByCategoryMap)
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount),
          expenseByCategory: Object.entries(expenseByCategoryMap)
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount),
        },
        counts: {
          projects: visibleProjects.length,
          activeSprints: sprints.filter((s) => s.isActive).length,
          totalSprints: sprints.length,
          clients: clientsCount,
        },
        tasks: taskStatus,
        features: featureStats,
        projects: projectStats,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      message: error.message || "Failed to load dashboard",
      success: false,
    });
  }
};
