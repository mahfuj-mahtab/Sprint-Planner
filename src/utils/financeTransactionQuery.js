import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import Partition from "../models/partition.models.js";
import { parseListQuery, paginationMeta } from "./projectAccess.js";
import { toObjectId } from "./mongoIds.js";
import { getPartitionsByOrg } from "./partitionFinance.js";
import { effectivePartitionScope } from "../constants/partitionScopes.js";

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
};

const partitionIdsForScope = async (orgId, scope) => {
  if (!scope || scope === "all") return null;
  const partitions = await getPartitionsByOrg(orgId);
  const ids = partitions
    .filter((p) => effectivePartitionScope(p) === scope)
    .map((p) => p._id);
  return ids;
};

const buildBaseFilter = (orgId, query, dateField) => {
  const orgOid = toObjectId(orgId);
  const filter = { organization_id: orgOid || orgId };

  const projectId = toObjectId(query.project_id);
  if (projectId) filter.project_id = projectId;

  const incomeSourceId = toObjectId(query.income_source_id);
  if (incomeSourceId) filter.income_source_id = incomeSourceId;

  const accountId = toObjectId(query.account_id);
  if (accountId) filter.account_id = accountId;

  if (query.category?.trim()) {
    filter.category = query.category.trim();
  }

  const dateFrom = parseDate(query.date_from);
  const dateTo = parseDate(query.date_to, true);
  if (dateFrom || dateTo) {
    filter[dateField] = {};
    if (dateFrom) filter[dateField].$gte = dateFrom;
    if (dateTo) filter[dateField].$lte = dateTo;
  }

  if (query.q?.trim()) {
    filter.notes = { $regex: query.q.trim(), $options: "i" };
  }

  return filter;
};

const incomePopulate = [
  { path: "project_id", select: "name" },
  { path: "client_id", select: "name" },
  { path: "income_source_id", select: "name status" },
  { path: "account_id", select: "name currency" },
];

const expensePopulate = [
  { path: "project_id", select: "name" },
  { path: "income_source_id", select: "name status" },
  { path: "account_id", select: "name currency" },
  { path: "partition_id", select: "name scope" },
  { path: "investor_id", select: "name" },
];

const enrichIncomePartitionNames = async (items) => {
  const partitionIds = new Set();
  for (const item of items) {
    for (const a of item.allocations || []) {
      const pid = a.partition_id?._id || a.partition_id;
      if (pid) partitionIds.add(pid.toString());
    }
  }
  if (!partitionIds.size) return items;

  const partitions = await Partition.find({ _id: { $in: [...partitionIds] } }).select("name scope");
  const nameMap = Object.fromEntries(partitions.map((p) => [p._id.toString(), p.name]));

  return items.map((item) => {
    const obj = item.toObject ? item.toObject() : { ...item };
    const firstAlloc = obj.allocations?.[0];
    const pid = firstAlloc?.partition_id?._id || firstAlloc?.partition_id;
    if (pid) {
      obj.partition_name = nameMap[pid.toString()] || "";
    }
    return obj;
  });
};

export const listIncomeTransactions = async (orgId, query) => {
  const { page, limit, skip } = parseListQuery(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildBaseFilter(orgId, query, "payment_date");

  const clientId = toObjectId(query.client_id);
  if (clientId) filter.client_id = clientId;

  const scope = query.scope?.trim()?.toLowerCase();
  if (scope && scope !== "all") {
    const partitionIds = await partitionIdsForScope(orgId, scope);
    if (!partitionIds?.length) {
      return {
        items: [],
        total: 0,
        pagination: paginationMeta(0, page, limit),
      };
    }
    filter.allocations = { $elemMatch: { partition_id: { $in: partitionIds } } };
  }

  const [total, docs] = await Promise.all([
    IncomeTransaction.countDocuments(filter),
    IncomeTransaction.find(filter)
      .sort({ payment_date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(incomePopulate),
  ]);

  const items = await enrichIncomePartitionNames(docs);

  return {
    items,
    total,
    pagination: paginationMeta(total, page, limit),
  };
};

export const listExpenseTransactions = async (orgId, query) => {
  const { page, limit, skip } = parseListQuery(query, { defaultLimit: 20, maxLimit: 100 });
  const filter = buildBaseFilter(orgId, query, "expense_date");

  const investorId = toObjectId(query.investor_id);
  if (investorId) filter.investor_id = investorId;

  if (query.is_personal === "true") filter.is_personal = true;
  if (query.is_personal === "false") filter.is_personal = false;

  const scope = query.scope?.trim()?.toLowerCase();
  if (scope && scope !== "all") {
    const partitionIds = await partitionIdsForScope(orgId, scope);
    if (!partitionIds?.length) {
      return {
        items: [],
        total: 0,
        pagination: paginationMeta(0, page, limit),
      };
    }
    filter.partition_id = { $in: partitionIds };
  }

  const [total, items] = await Promise.all([
    ExpenseTransaction.countDocuments(filter),
    ExpenseTransaction.find(filter)
      .sort({ expense_date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(expensePopulate)
      .lean(),
  ]);

  return {
    items,
    total,
    pagination: paginationMeta(total, page, limit),
  };
};
