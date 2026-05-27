import IncomeSource from "../models/incomeSource.models.js";
import Project from "../models/project.models.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import { toObjectId } from "../utils/mongoIds.js";
import {
  normalizeForecastPeriods,
  enrichIncomeSource,
  aggregateExpectedEarnings,
  buildOrgIncomeForecast,
  EXPECTED_EARNING_PERIODS,
} from "../utils/incomeSourceMetrics.js";
import {
  INCOME_SOURCE_PRIORITIES,
  INCOME_SOURCE_STATUSES,
  INCOME_SOURCE_TYPES,
} from "../constants/incomeSource.js";
import { normalizeFinanceCurrency } from "../constants/financeCurrencies.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const resolveProjectId = async (project_id, orgId) => {
  const oid = toObjectId(project_id);
  if (!oid) return null;
  const project = await Project.findOne({ _id: oid, organization_id: orgId });
  if (!project) {
    const err = new Error("Project not found in this organization");
    err.status = 400;
    throw err;
  }
  return oid;
};

const parseBody = (body) => {
  const status = INCOME_SOURCE_STATUSES.includes(body.status) ? body.status : undefined;
  const type = INCOME_SOURCE_TYPES.includes(body.type) ? body.type : undefined;
  const normalizedPriority = String(body.priority || "").toLowerCase();
  const priority = INCOME_SOURCE_PRIORITIES.includes(normalizedPriority)
    ? normalizedPriority
    : undefined;
  const planned_investment =
    body.planned_investment != null && body.planned_investment !== ""
      ? Math.max(0, Number(body.planned_investment))
      : undefined;
  const revenue_start_after_months =
    body.revenue_start_after_months != null && body.revenue_start_after_months !== ""
      ? Math.max(0, Math.round(Number(body.revenue_start_after_months)))
      : undefined;
  const forecast_periods =
    body.forecast_periods !== undefined
      ? normalizeForecastPeriods(body.forecast_periods)
      : undefined;

  let expected_earning_amount;
  if (body.expected_earning_amount !== undefined) {
    if (body.expected_earning_amount === null || body.expected_earning_amount === "") {
      expected_earning_amount = null;
    } else {
      expected_earning_amount = Math.max(0, Number(body.expected_earning_amount));
    }
  }
  let expected_earning_period;
  if (body.expected_earning_period !== undefined) {
    expected_earning_period = EXPECTED_EARNING_PERIODS.includes(body.expected_earning_period)
      ? body.expected_earning_period
      : "monthly";
  }

  return {
    name: body.name?.trim(),
    description: typeof body.description === "string" ? body.description.trim() : undefined,
    status,
    priority,
    type,
    currency:
      body.currency !== undefined
        ? normalizeFinanceCurrency(body.currency, "BDT")
        : undefined,
    planned_investment,
    revenue_start_after_months,
    forecast_periods,
    expected_earning_amount,
    expected_earning_period,
    started_at: body.started_at ? new Date(body.started_at) : body.started_at === null ? null : undefined,
    notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
  };
};

export const incomeSourceList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const sources = await IncomeSource.find({ organization_id: orgId })
      .populate("project_id", "name")
      .sort({ updatedAt: -1 });
    const enriched = await Promise.all(sources.map((s) => enrichIncomeSource(s, orgId)));
    const expectedTotals = aggregateExpectedEarnings(enriched);
    const forecastMatrix = buildOrgIncomeForecast(enriched);
    return res.status(200).json({
      message: "Income sources retrieved",
      success: true,
      sources: enriched,
      expectedTotals,
      forecastMatrix,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const incomeSourceGet = async (req, res) => {
  const { orgId, sourceId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const source = await IncomeSource.findOne({ _id: sourceId, organization_id: orgId }).populate(
      "project_id",
      "name"
    );
    if (!source) {
      return res.status(404).json({ message: "Income source not found", success: false });
    }
    const enriched = await enrichIncomeSource(source, orgId);
    return res.status(200).json({
      message: "Income source retrieved",
      success: true,
      source: enriched,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const incomeSourceCreate = async (req, res) => {
  const { orgId } = req.params;
  const parsed = parseBody(req.body);

  if (!parsed.name) {
    return res.status(400).json({ message: "Name is required", success: false });
  }

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const project_id = await resolveProjectId(req.body.project_id, orgId);

    const source = new IncomeSource({
      organization_id: orgId,
      name: parsed.name,
      description: parsed.description ?? "",
      type:
        parsed.type ||
        (INCOME_SOURCE_TYPES.includes(req.body.type) ? req.body.type : "other"),
      status: parsed.status || "idea",
      priority:
        parsed.priority ||
        (INCOME_SOURCE_PRIORITIES.includes(String(req.body.priority || "").toLowerCase())
          ? String(req.body.priority || "").toLowerCase()
          : "medium"),
      currency: normalizeFinanceCurrency(parsed.currency || req.body.currency, "BDT"),
      planned_investment: parsed.planned_investment ?? 0,
      revenue_start_after_months: parsed.revenue_start_after_months ?? 0,
      expected_earning_amount:
        parsed.expected_earning_amount !== undefined ? parsed.expected_earning_amount : null,
      expected_earning_period: parsed.expected_earning_period || "monthly",
      forecast_periods: parsed.forecast_periods ?? [],
      project_id,
      started_at: parsed.started_at ?? (req.body.started_at ? new Date(req.body.started_at) : null),
      notes: parsed.notes ?? "",
    });

    if (["started", "working", "live"].includes(source.status) && !source.started_at) {
      source.started_at = new Date();
    }

    await source.save();
    const enriched = await enrichIncomeSource(source, orgId);
    return res.status(201).json({
      message: "Income source created",
      success: true,
      source: enriched,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "An income source with this name already exists", success: false });
    }
    return handleError(res, error);
  }
};

export const incomeSourceUpdate = async (req, res) => {
  const { orgId, sourceId } = req.params;
  const parsed = parseBody(req.body);

  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const source = await IncomeSource.findOne({ _id: sourceId, organization_id: orgId });
    if (!source) {
      return res.status(404).json({ message: "Income source not found", success: false });
    }

    if (parsed.name) source.name = parsed.name;
    if (parsed.description !== undefined) source.description = parsed.description;
    if (parsed.status) {
      source.status = parsed.status;
      if (["started", "working", "live"].includes(parsed.status) && !source.started_at) {
        source.started_at = new Date();
      }
    }
    if (parsed.priority) source.priority = parsed.priority;
    if (parsed.type) source.type = parsed.type;
    if (parsed.currency) source.currency = parsed.currency;
    if (parsed.planned_investment !== undefined) source.planned_investment = parsed.planned_investment;
    if (parsed.revenue_start_after_months !== undefined) {
      source.revenue_start_after_months = parsed.revenue_start_after_months;
    }
    if (parsed.forecast_periods !== undefined) source.forecast_periods = parsed.forecast_periods;
    if (parsed.expected_earning_amount !== undefined) {
      source.expected_earning_amount = parsed.expected_earning_amount;
    }
    if (parsed.expected_earning_period !== undefined) {
      source.expected_earning_period = parsed.expected_earning_period;
    }
    if (parsed.started_at !== undefined) source.started_at = parsed.started_at;
    if (parsed.notes !== undefined) source.notes = parsed.notes;
    if (req.body.project_id !== undefined) {
      source.project_id = await resolveProjectId(req.body.project_id, orgId);
    }

    await source.save();
    const enriched = await enrichIncomeSource(source, orgId);
    return res.status(200).json({
      message: "Income source updated",
      success: true,
      source: enriched,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "An income source with this name already exists", success: false });
    }
    return handleError(res, error);
  }
};

export const incomeSourceDelete = async (req, res) => {
  const { orgId, sourceId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const source = await IncomeSource.findOneAndDelete({ _id: sourceId, organization_id: orgId });
    if (!source) {
      return res.status(404).json({ message: "Income source not found", success: false });
    }
    return res.status(200).json({ message: "Income source deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const resolveIncomeSourceId = async (income_source_id, orgId) => {
  const oid = toObjectId(income_source_id);
  if (!oid) return null;
  const source = await IncomeSource.findOne({ _id: oid, organization_id: orgId });
  if (!source) {
    const err = new Error("Income source not found");
    err.status = 400;
    throw err;
  }
  return oid;
};
