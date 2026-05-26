import Partition from "../models/partition.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import { effectivePartitionScope } from "../constants/partitionScopes.js";
import { toObjectId } from "./mongoIds.js";

export const getPartitionsByOrg = async (orgId) => {
  return Partition.find({ organization_id: orgId });
};

export const getPartitionIdsByScope = async (orgId, scope) => {
  const partitions = await getPartitionsByOrg(orgId);
  return partitions.filter((p) => effectivePartitionScope(p) === scope).map((p) => p._id);
};

export const sumBalancesByScope = (partitions) => {
  const totals = { business: 0, owner: 0, excluded: 0, all: 0 };
  for (const p of partitions) {
    const bal = Number(p.balance) || 0;
    totals.all += bal;
    totals[effectivePartitionScope(p)] += bal;
  }
  return totals;
};

export const sumBusinessIncomeInRange = async (orgId, start, end) => {
  const businessIds = await getPartitionIdsByScope(orgId, "business");
  if (!businessIds.length) return 0;

  const orgOid = toObjectId(orgId);
  const result = await IncomeTransaction.aggregate([
    {
      $match: {
        organization_id: orgOid,
        payment_date: { $gte: start, $lte: end },
      },
    },
    { $unwind: "$allocations" },
    { $match: { "allocations.partition_id": { $in: businessIds } } },
    { $group: { _id: null, total: { $sum: "$allocations.amount" } } },
  ]);
  return result[0]?.total || 0;
};

export const sumBusinessExpenseInRange = async (orgId, start, end) => {
  const businessIds = await getPartitionIdsByScope(orgId, "business");
  if (!businessIds.length) return 0;

  const orgOid = toObjectId(orgId);
  const result = await ExpenseTransaction.aggregate([
    {
      $match: {
        organization_id: orgOid,
        expense_date: { $gte: start, $lte: end },
        partition_id: { $in: businessIds },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return result[0]?.total || 0;
};

export const sumIncomeAllocationsForScopes = (income, partitionScopeMap, scopes) => {
  const scopeSet = new Set(scopes);
  return (income.allocations || []).reduce((sum, a) => {
    const scope = partitionScopeMap[a.partition_id?.toString()];
    if (scopeSet.has(scope)) return sum + Number(a.amount);
    return sum;
  }, 0);
};

export const buildPartitionScopeMap = (partitions) => {
  const map = {};
  for (const p of partitions) {
    map[p._id.toString()] = effectivePartitionScope(p);
  }
  return map;
};

export const assertExpensePartitionScope = (partition, isPersonal) => {
  const scope = effectivePartitionScope(partition);
  if (isPersonal) {
    if (scope !== "owner" && scope !== "excluded") {
      const err = new Error("Personal expenses must use an Owner or Excluded partition");
      err.status = 400;
      throw err;
    }
    return;
  }
  if (scope !== "business") {
    const err = new Error("Business expenses must use a Business partition");
    err.status = 400;
    throw err;
  }
};
