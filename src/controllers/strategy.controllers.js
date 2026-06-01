import OrgStrategy from "../models/orgStrategy.models.js";
import StrategicPillar from "../models/strategicPillar.models.js";
import OrgStrategicGoal from "../models/orgStrategicGoal.models.js";
import OrgKpi from "../models/orgKpi.models.js";
import OrgKpiEntry from "../models/orgKpiEntry.models.js";
import StrategyReview from "../models/strategyReview.models.js";
import Project from "../models/project.models.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import {
  GOAL_LEVELS,
  GOAL_STATUSES,
  KPI_CATEGORIES,
  KPI_FREQUENCIES,
  REVIEW_TYPES,
  CHECKLIST_CATEGORIES,
  LONG_TERM_LEVELS,
} from "../constants/strategy.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const parseNum = (v, field) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) {
    const err = new Error(`Invalid ${field}`);
    err.status = 400;
    throw err;
  }
  return n;
};

const parseDate = (value) => {
  if (value === null || value === "") return null;
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("Invalid date");
    err.status = 400;
    throw err;
  }
  return d;
};

const deriveGoalProgress = (goal) => {
  const krs = goal.key_results || [];
  if (krs.length > 0) {
    const pct =
      krs.reduce((sum, kr) => {
        if (kr.target != null && kr.target > 0) {
          const t = Number(kr.target) || 1;
          const c = Math.min(Number(kr.current) || 0, t);
          return sum + (c / t) * 100;
        }
        return sum + (kr.completed ? 100 : 0);
      }, 0) / krs.length;
    return Math.round(Math.min(100, pct));
  }
  if (goal.target_value != null && goal.target_value > 0) {
    const pct = ((Number(goal.current_value) || 0) / goal.target_value) * 100;
    return Math.round(Math.min(100, pct));
  }
  return Math.min(100, Math.max(0, Number(goal.progress_percent) || 0));
};

const serializeGoal = (doc) => {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.progress_percent = deriveGoalProgress(obj);
  return obj;
};

const parentIdStr = (goal) => {
  if (!goal?.parent_id) return null;
  return goal.parent_id._id?.toString() || goal.parent_id.toString();
};

const attachRollupToGoals = (goals) => {
  const list = goals.map((g) => ({ ...g }));
  const byId = Object.fromEntries(list.map((g) => [g._id.toString(), g]));
  const childrenOf = {};
  for (const g of list) {
    const pid = parentIdStr(g);
    if (pid) {
      if (!childrenOf[pid]) childrenOf[pid] = [];
      childrenOf[pid].push(g);
    }
  }
  const rollup = (id) => {
    const kids = childrenOf[id] || [];
    if (!kids.length) return deriveGoalProgress(byId[id] || {});
    return Math.round(kids.reduce((sum, k) => sum + rollup(k._id.toString()), 0) / kids.length);
  };
  return list.map((g) => {
    const id = g._id.toString();
    const kids = childrenOf[id] || [];
    return {
      ...g,
      child_count: kids.length,
      rollup_progress: rollup(id),
      uses_rollup: kids.length > 0,
    };
  });
};

const assertParentLink = async (orgId, level, parentId, year) => {
  if (!parentId) return;
  const parent = await OrgStrategicGoal.findOne({ _id: parentId, organization_id: orgId });
  if (!parent) {
    const err = new Error("Parent goal not found");
    err.status = 400;
    throw err;
  }
  if (level === "annual") {
    if (!LONG_TERM_LEVELS.includes(parent.level)) {
      const err = new Error("Year goal must link to a long term goal");
      err.status = 400;
      throw err;
    }
  }
  if (level === "quarterly") {
    if (parent.level !== "annual") {
      const err = new Error("Quarter goal must link to a year goal");
      err.status = 400;
      throw err;
    }
    if (year != null && parent.year != null && parent.year !== year) {
      const err = new Error("Parent year goal must be the same year");
      err.status = 400;
      throw err;
    }
  }
  if (LONG_TERM_LEVELS.includes(level) && parentId) {
    const err = new Error("Long term goals cannot have a parent");
    err.status = 400;
    throw err;
  }
};

const DEFAULT_WEEKLY_TEMPLATE = [
  { label: "Review growth metrics (signups, revenue, customers)", category: "growth" },
  { label: "Review product shipped & bugs", category: "product" },
  { label: "Review marketing & leads", category: "marketing" },
  { label: "Review cash & expenses", category: "finance" },
];

const getWeeklyTemplate = (strategy) => {
  const custom = strategy?.weekly_checklist_template;
  if (custom?.length > 0) return custom;
  return DEFAULT_WEEKLY_TEMPLATE;
};

const checklistFromTemplate = (strategy, existingChecklist) => {
  if (existingChecklist?.length > 0) {
    return existingChecklist.map((c) => ({
      label: c.label,
      category: c.category || "growth",
      done: Boolean(c.done),
      _id: c._id,
    }));
  }
  return getWeeklyTemplate(strategy).map((t) => ({
    label: t.label,
    category: t.category || "growth",
    done: false,
  }));
};

const getIsoWeek = (date = new Date()) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
};

const computeSetupProgress = (strategy, quarterlyGoals, kpis, pillars) => {
  const steps = [
    {
      id: "vision",
      label: "North star",
      done: Boolean(strategy?.vision_10y?.trim() || strategy?.bhag_title?.trim()),
    },
    {
      id: "pillars",
      label: "Strategic pillars",
      done: pillars.length >= 1,
    },
    {
      id: "okr",
      label: "Quarterly OKR",
      done: quarterlyGoals.length >= 1,
    },
    {
      id: "kpi",
      label: "Track a KPI",
      done: kpis.length >= 1,
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    is_complete: completed === steps.length,
  };
};

export const strategyOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await getOrgForMember(orgId, req.user._id);

    let strategy = await OrgStrategy.findOne({ organization_id: orgId });
    if (!strategy) {
      strategy = await OrgStrategy.create({ organization_id: orgId });
    }

    const pillars = await StrategicPillar.find({ organization_id: orgId }).sort({
      sort_order: 1,
      createdAt: 1,
    });

    const goals = await OrgStrategicGoal.find({ organization_id: orgId })
      .populate("owner_id", "name email")
      .populate("pillar_id", "name color")
      .populate("parent_id", "title level year quarter status")
      .populate("project_ids", "name status project_type")
      .sort({ sort_order: 1, year: -1, quarter: -1, createdAt: 1 });

    const serializedGoals = attachRollupToGoals(goals.map(serializeGoal));

    const kpis = await OrgKpi.find({ organization_id: orgId }).sort({ sort_order: 1, createdAt: 1 });
    const kpiIds = kpis.map((k) => k._id);
    const latestEntries = await OrgKpiEntry.aggregate([
      { $match: { kpi_id: { $in: kpiIds } } },
      { $sort: { recorded_at: -1 } },
      {
        $group: {
          _id: "$kpi_id",
          value: { $first: "$value" },
          recorded_at: { $first: "$recorded_at" },
        },
      },
    ]);
    const entryMap = Object.fromEntries(latestEntries.map((e) => [e._id.toString(), e]));

    const kpiHistory =
      kpiIds.length > 0
        ? await OrgKpiEntry.find({ kpi_id: { $in: kpiIds } })
            .sort({ recorded_at: -1 })
            .limit(200)
            .select("kpi_id value recorded_at")
        : [];
    const historyByKpi = {};
    for (const entry of kpiHistory) {
      const id = entry.kpi_id.toString();
      if (!historyByKpi[id]) historyByKpi[id] = [];
      if (historyByKpi[id].length < 12) {
        historyByKpi[id].push({
          value: entry.value,
          recorded_at: entry.recorded_at,
        });
      }
    }

    const enrichedKpis = kpis.map((k) => {
      const latest = entryMap[k._id.toString()];
      const history = (historyByKpi[k._id.toString()] || []).slice().reverse();
      return {
        ...k.toObject(),
        latest_value: latest?.value ?? k.current_value,
        latest_recorded_at: latest?.recorded_at ?? null,
        history,
      };
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
    const { year: weekYear, week: currentWeek } = getIsoWeek(now);

    const quarterlyGoals = serializedGoals.filter(
      (g) => g.level === "quarterly" && g.year === currentYear && g.quarter === currentQuarter
    );
    const annualGoals = serializedGoals.filter((g) => g.level === "annual" && g.year === currentYear);

    const avgOkrProgress =
      quarterlyGoals.length > 0
        ? Math.round(
            quarterlyGoals.reduce((s, g) => s + (g.progress_percent || 0), 0) / quarterlyGoals.length
          )
        : 0;

    let weeklyReview = await StrategyReview.findOne({
      organization_id: orgId,
      review_type: "weekly",
      year: weekYear,
      period: currentWeek,
    });

    const strategyObj = strategy.toObject();

    if (!weeklyReview) {
      weeklyReview = {
        review_type: "weekly",
        year: weekYear,
        period: currentWeek,
        period_label: `Week ${currentWeek}, ${weekYear}`,
        checklist: checklistFromTemplate(strategyObj),
        _isTemplate: true,
      };
    } else if (typeof weeklyReview.toObject === "function") {
      const wrObj = weeklyReview.toObject();
      weeklyReview = {
        ...wrObj,
        checklist: checklistFromTemplate(strategyObj, wrObj.checklist),
      };
    }

    const recentReviews = await StrategyReview.find({ organization_id: orgId })
      .sort({ year: -1, period: -1, updatedAt: -1 })
      .limit(8)
      .populate("created_by", "name email");

    const projects = await Project.find({ organization_id: orgId, isArchived: { $ne: true } }).select(
      "_id name status project_type"
    );

    const goalsByLevel = {};
    for (const level of GOAL_LEVELS) {
      goalsByLevel[level] = serializedGoals.filter((g) => g.level === level);
    }

    const setup_progress = computeSetupProgress(
      strategy.toObject(),
      quarterlyGoals,
      enrichedKpis,
      pillars
    );

    const weeklyReviewObj =
      weeklyReview && typeof weeklyReview.toObject === "function"
        ? weeklyReview.toObject()
        : weeklyReview;

    const checklistDone = (weeklyReviewObj.checklist || []).filter((c) => c.done).length;
    const checklistTotal = (weeklyReviewObj.checklist || []).length;

    return res.status(200).json({
      success: true,
      strategy: strategy.toObject(),
      pillars,
      goals: serializedGoals,
      goals_by_level: goalsByLevel,
      kpis: enrichedKpis,
      weekly_review: weeklyReviewObj,
      recent_reviews: recentReviews,
      projects,
      setup_progress,
      summary: {
        pillar_count: pillars.length,
        goal_count: serializedGoals.length,
        active_goals: serializedGoals.filter((g) => g.status === "active").length,
        at_risk_goals: serializedGoals.filter((g) => g.status === "at_risk").length,
        annual_count: annualGoals.length,
        quarterly_count: quarterlyGoals.length,
        avg_quarterly_progress: avgOkrProgress,
        kpi_count: kpis.length,
        current_year: currentYear,
        current_quarter: currentQuarter,
        current_week: currentWeek,
        week_year: weekYear,
        checklist_done: checklistDone,
        checklist_total: checklistTotal,
      },
      access,
      enums: {
        goal_levels: GOAL_LEVELS,
        goal_statuses: GOAL_STATUSES,
        kpi_categories: KPI_CATEGORIES,
        kpi_frequencies: KPI_FREQUENCIES,
        review_types: REVIEW_TYPES,
        checklist_categories: CHECKLIST_CATEGORIES,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const strategyProfileUpdate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const updates = {};
    const fields = [
      "vision_10y",
      "mission",
      "core_values",
      "bhag_title",
      "bhag_description",
      "bhag_target",
      "bhag_target_year",
      "long_term_completed",
      "weekly_checklist_template",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.bhag_target_year !== undefined) {
      updates.bhag_target_year = parseNum(updates.bhag_target_year, "bhag_target_year");
    }
    const strategy = await OrgStrategy.findOneAndUpdate(
      { organization_id: orgId },
      { $set: updates },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, strategy });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name, description, color, sort_order } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    if (!name?.trim()) {
      const err = new Error("Pillar name is required");
      err.status = 400;
      throw err;
    }
    const pillar = await StrategicPillar.create({
      organization_id: orgId,
      name: name.trim(),
      description: description?.trim() || "",
      color: color || "#00d4ff",
      sort_order: sort_order ?? 0,
    });
    return res.status(201).json({ success: true, pillar });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarUpdate = async (req, res) => {
  const { orgId, pillarId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const pillar = await StrategicPillar.findOneAndUpdate(
      { _id: pillarId, organization_id: orgId },
      {
        $set: {
          ...(req.body.name !== undefined && { name: req.body.name.trim() }),
          ...(req.body.description !== undefined && { description: req.body.description }),
          ...(req.body.color !== undefined && { color: req.body.color }),
          ...(req.body.sort_order !== undefined && { sort_order: req.body.sort_order }),
        },
      },
      { new: true }
    );
    if (!pillar) {
      const err = new Error("Pillar not found");
      err.status = 404;
      throw err;
    }
    return res.status(200).json({ success: true, pillar });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarDelete = async (req, res) => {
  const { orgId, pillarId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const pillar = await StrategicPillar.findOneAndDelete({ _id: pillarId, organization_id: orgId });
    if (!pillar) {
      const err = new Error("Pillar not found");
      err.status = 404;
      throw err;
    }
    await OrgStrategicGoal.updateMany(
      { organization_id: orgId, pillar_id: pillarId },
      { $set: { pillar_id: null } }
    );
    return res.status(200).json({ success: true, message: "Pillar deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

const parseGoalBody = (body, isCreate = false) => {
  const data = {};
  if (body.title !== undefined) data.title = String(body.title).trim();
  if (isCreate && !data.title) {
    const err = new Error("Goal title is required");
    err.status = 400;
    throw err;
  }
  if (body.level !== undefined) {
    if (!GOAL_LEVELS.includes(body.level)) {
      const err = new Error("Invalid goal level");
      err.status = 400;
      throw err;
    }
    data.level = body.level;
  }
  if (body.description !== undefined) data.description = body.description;
  if (body.parent_id !== undefined) data.parent_id = body.parent_id || null;
  if (body.pillar_id !== undefined) data.pillar_id = body.pillar_id || null;
  if (body.year !== undefined) data.year = parseNum(body.year, "year");
  if (body.quarter !== undefined) data.quarter = parseNum(body.quarter, "quarter");
  if (body.month !== undefined) data.month = parseNum(body.month, "month");
  if (body.target_value !== undefined) data.target_value = parseNum(body.target_value, "target_value");
  if (body.current_value !== undefined) data.current_value = parseNum(body.current_value, "current_value") ?? 0;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.progress_percent !== undefined) data.progress_percent = parseNum(body.progress_percent, "progress_percent");
  if (body.status !== undefined) {
    if (!GOAL_STATUSES.includes(body.status)) {
      const err = new Error("Invalid status");
      err.status = 400;
      throw err;
    }
    data.status = body.status;
  }
  if (body.owner_id !== undefined) data.owner_id = body.owner_id || null;
  if (body.project_ids !== undefined) data.project_ids = body.project_ids || [];
  if (body.key_results !== undefined) data.key_results = body.key_results;
  if (body.sort_order !== undefined) data.sort_order = body.sort_order;
  if (body.due_date !== undefined) data.due_date = parseDate(body.due_date);
  return data;
};

export const goalCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const data = parseGoalBody(req.body, true);
    if (!data.level) data.level = "annual";
    await assertParentLink(orgId, data.level, data.parent_id, data.year);
    if (data.level === "long_term" && (!data.project_ids || data.project_ids.length === 0)) {
      const err = new Error("Long term goals must be linked to a project");
      err.status = 400;
      throw err;
    }
    const goal = await OrgStrategicGoal.create({
      organization_id: orgId,
      ...data,
    });
    const populated = await OrgStrategicGoal.findById(goal._id)
      .populate("owner_id", "name email")
      .populate("pillar_id", "name color")
      .populate("parent_id", "title level year quarter status")
      .populate("project_ids", "name status");
    return res.status(201).json({ success: true, goal: serializeGoal(populated) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalUpdate = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const existing = await OrgStrategicGoal.findOne({ _id: goalId, organization_id: orgId });
    if (!existing) {
      const err = new Error("Goal not found");
      err.status = 404;
      throw err;
    }
    const data = parseGoalBody(req.body);
    const level = data.level ?? existing.level;
    const parentId = data.parent_id !== undefined ? data.parent_id : existing.parent_id;
    const goalYear = data.year !== undefined ? data.year : existing.year;
    const projectIds = data.project_ids !== undefined ? data.project_ids : existing.project_ids;
    await assertParentLink(orgId, level, parentId, goalYear);
    if (level === "long_term" && (!projectIds || projectIds.length === 0)) {
      const err = new Error("Long term goals must be linked to a project");
      err.status = 400;
      throw err;
    }
    const goal = await OrgStrategicGoal.findOneAndUpdate(
      { _id: goalId, organization_id: orgId },
      { $set: data },
      { new: true }
    )
      .populate("owner_id", "name email")
      .populate("pillar_id", "name color")
      .populate("parent_id", "title level year quarter status")
      .populate("project_ids", "name status");
    if (!goal) {
      const err = new Error("Goal not found");
      err.status = 404;
      throw err;
    }
    return res.status(200).json({ success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalKeyResultUpdate = async (req, res) => {
  const { orgId, goalId } = req.params;
  const { kr_id, current, completed } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    if (!kr_id) {
      const err = new Error("kr_id is required");
      err.status = 400;
      throw err;
    }
    const goal = await OrgStrategicGoal.findOne({ _id: goalId, organization_id: orgId });
    if (!goal) {
      const err = new Error("Goal not found");
      err.status = 404;
      throw err;
    }
    const kr = goal.key_results.id(kr_id);
    if (!kr) {
      const err = new Error("Key result not found");
      err.status = 404;
      throw err;
    }
    if (current !== undefined) kr.current = parseNum(current, "current") ?? kr.current;
    if (completed !== undefined) kr.completed = Boolean(completed);
    if (kr.target != null && kr.current >= kr.target) kr.completed = true;
    await goal.save();
    const populated = await OrgStrategicGoal.findById(goal._id)
      .populate("owner_id", "name email")
      .populate("pillar_id", "name color")
      .populate("project_ids", "name status");
    return res.status(200).json({ success: true, goal: serializeGoal(populated) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalDelete = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await OrgStrategicGoal.findOneAndDelete({ _id: goalId, organization_id: orgId });
    if (!goal) {
      const err = new Error("Goal not found");
      err.status = 404;
      throw err;
    }
    await OrgStrategicGoal.updateMany(
      { organization_id: orgId, parent_id: goalId },
      { $set: { parent_id: null } }
    );
    return res.status(200).json({ success: true, message: "Goal deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const kpiCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name, description, category, unit, target_value, current_value, frequency, pillar_id, is_higher_better } =
    req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    if (!name?.trim()) {
      const err = new Error("KPI name is required");
      err.status = 400;
      throw err;
    }
    const kpi = await OrgKpi.create({
      organization_id: orgId,
      name: name.trim(),
      description: description?.trim() || "",
      category: category || "growth",
      unit: unit || "",
      target_value: parseNum(target_value, "target_value"),
      current_value: parseNum(current_value, "current_value") ?? 0,
      frequency: frequency || "monthly",
      pillar_id: pillar_id || null,
      is_higher_better: is_higher_better !== false,
    });
    return res.status(201).json({ success: true, kpi });
  } catch (error) {
    return handleError(res, error);
  }
};

export const kpiUpdate = async (req, res) => {
  const { orgId, kpiId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const updates = {};
    const fields = ["name", "description", "category", "unit", "frequency", "pillar_id", "is_higher_better", "sort_order"];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.target_value !== undefined) updates.target_value = parseNum(req.body.target_value, "target_value");
    if (req.body.current_value !== undefined) updates.current_value = parseNum(req.body.current_value, "current_value");
    const kpi = await OrgKpi.findOneAndUpdate({ _id: kpiId, organization_id: orgId }, { $set: updates }, { new: true });
    if (!kpi) {
      const err = new Error("KPI not found");
      err.status = 404;
      throw err;
    }
    return res.status(200).json({ success: true, kpi });
  } catch (error) {
    return handleError(res, error);
  }
};

export const kpiDelete = async (req, res) => {
  const { orgId, kpiId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const kpi = await OrgKpi.findOneAndDelete({ _id: kpiId, organization_id: orgId });
    if (!kpi) {
      const err = new Error("KPI not found");
      err.status = 404;
      throw err;
    }
    await OrgKpiEntry.deleteMany({ kpi_id: kpiId });
    return res.status(200).json({ success: true, message: "KPI deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const kpiEntryCreate = async (req, res) => {
  const { orgId, kpiId } = req.params;
  const { value, recorded_at, note } = req.body;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const kpi = await OrgKpi.findOne({ _id: kpiId, organization_id: orgId });
    if (!kpi) {
      const err = new Error("KPI not found");
      err.status = 404;
      throw err;
    }
    const numVal = parseNum(value, "value");
    if (numVal === null) {
      const err = new Error("Value is required");
      err.status = 400;
      throw err;
    }
    const entry = await OrgKpiEntry.create({
      organization_id: orgId,
      kpi_id: kpiId,
      value: numVal,
      recorded_at: parseDate(recorded_at) || new Date(),
      note: note?.trim() || "",
      recorded_by: req.user._id,
    });
    kpi.current_value = numVal;
    await kpi.save();
    return res.status(201).json({ success: true, entry, kpi });
  } catch (error) {
    return handleError(res, error);
  }
};

export const kpiEntriesList = async (req, res) => {
  const { orgId, kpiId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const entries = await OrgKpiEntry.find({ kpi_id: kpiId, organization_id: orgId })
      .sort({ recorded_at: -1 })
      .limit(50)
      .populate("recorded_by", "name email");
    return res.status(200).json({ success: true, entries });
  } catch (error) {
    return handleError(res, error);
  }
};

export const reviewUpsert = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const {
      review_type,
      year,
      period,
      period_label,
      period_start,
      period_end,
      achievements,
      failed,
      why_failed,
      stop_doing,
      continue_doing,
      start_doing,
      okr_score_percent,
      notes,
      checklist,
    } = req.body;

    if (!REVIEW_TYPES.includes(review_type)) {
      const err = new Error("Invalid review type");
      err.status = 400;
      throw err;
    }
    const y = parseNum(year, "year");
    if (!y) {
      const err = new Error("Year is required");
      err.status = 400;
      throw err;
    }

    const review = await StrategyReview.findOneAndUpdate(
      {
        organization_id: orgId,
        review_type,
        year: y,
        period: period ?? null,
      },
      {
        $set: {
          period_label: period_label || "",
          period_start: parseDate(period_start),
          period_end: parseDate(period_end),
          achievements: achievements ?? "",
          failed: failed ?? "",
          why_failed: why_failed ?? "",
          stop_doing: stop_doing ?? "",
          continue_doing: continue_doing ?? "",
          start_doing: start_doing ?? "",
          okr_score_percent: parseNum(okr_score_percent, "okr_score_percent"),
          notes: notes ?? "",
          ...(checklist !== undefined && { checklist }),
          created_by: req.user._id,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, review });
  } catch (error) {
    return handleError(res, error);
  }
};

export const reviewList = async (req, res) => {
  const { orgId } = req.params;
  const { type } = req.query;
  try {
    await getOrgForMember(orgId, req.user._id);
    const filter = { organization_id: orgId };
    if (type && REVIEW_TYPES.includes(type)) filter.review_type = type;
    const reviews = await StrategyReview.find(filter)
      .sort({ year: -1, period: -1 })
      .populate("created_by", "name email");
    return res.status(200).json({ success: true, reviews });
  } catch (error) {
    return handleError(res, error);
  }
};

export const reviewDelete = async (req, res) => {
  const { orgId, reviewId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const review = await StrategyReview.findOneAndDelete({ _id: reviewId, organization_id: orgId });
    if (!review) {
      const err = new Error("Review not found");
      err.status = 404;
      throw err;
    }
    return res.status(200).json({ success: true, message: "Review deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};
