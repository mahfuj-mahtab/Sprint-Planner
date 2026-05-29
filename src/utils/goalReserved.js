import FinanceGoal from "../models/financeGoal.models.js";
import Partition from "../models/partition.models.js";

export const goalAllocated = (goal) =>
  (goal.allocations || []).reduce((sum, log) => sum + Number(log.amount || 0), 0);

export const goalSettled = (goal) =>
  (goal.settlements || []).reduce((sum, log) => sum + Number(log.amount || 0), 0);

export const goalReserved = (goal) => Math.max(0, goalAllocated(goal) - goalSettled(goal));

export const reservedByPartition = (goals, opts = {}) => {
  const { excludeGoalId, excludeAllocationId } = opts;
  const totals = {};
  for (const goal of goals || []) {
    const goalId = goal._id?.toString();
    if (excludeGoalId && goalId === excludeGoalId) continue;
    const allocations = (goal.allocations || []).filter(
      (log) =>
        log?.partition_id &&
        (!excludeAllocationId || log._id?.toString() !== excludeAllocationId)
    );
    let settledRemaining = goalSettled(goal);
    for (let i = allocations.length - 1; i >= 0; i -= 1) {
      const log = allocations[i];
      const amount = Number(log.amount || 0);
      if (amount <= 0) continue;
      const settledHere = Math.min(settledRemaining, amount);
      settledRemaining -= settledHere;
      const reservedAmount = amount - settledHere;
      if (reservedAmount <= 0) continue;
      const key = log.partition_id.toString();
      totals[key] = (totals[key] || 0) + reservedAmount;
    }
  }
  return totals;
};

export const getPartitionAvailableBalance = async (partitionId, orgId, opts = {}) => {
  const partition = await Partition.findOne({ _id: partitionId, organization_id: orgId });
  if (!partition) {
    const err = new Error("Partition not found");
    err.status = 404;
    throw err;
  }
  const allGoals = await FinanceGoal.find({ organization_id: orgId });
  const reservedMap = reservedByPartition(allGoals, opts);
  const reserved = Number(reservedMap[partitionId.toString()] || 0);
  const available = Math.max(0, Number(partition.balance || 0) - reserved);
  return { partition, available, reserved };
};
