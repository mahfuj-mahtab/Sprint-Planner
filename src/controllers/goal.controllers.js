import FinanceGoal from "../models/financeGoal.models.js";
import FinancialAccount from "../models/financialAccount.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import { GOAL_PRIORITIES, GOAL_SETTLEMENT_STATUSES, GOAL_TYPES } from "../constants/goal.js";
import { effectivePartitionScope } from "../constants/partitionScopes.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import { assertPartitionInAccount, resolveCategoryName } from "./finance.controllers.js";
import { applyPartitionDelta, withTransaction } from "../utils/partitionBalance.js";
import {
  goalAllocated,
  goalSettled,
  goalReserved,
  getPartitionAvailableBalance,
} from "../utils/goalReserved.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
  });
};

const serializeGoal = (goal) => {
  const doc = goal.toObject ? goal.toObject() : goal;
  return {
    _id: doc._id,
    id: doc._id?.toString(),
    title: doc.title,
    target: doc.target,
    type: doc.type,
    priority: doc.priority,
    currency: doc.currency,
    expected_at: doc.expected_at,
    expectedAt: doc.expected_at ? new Date(doc.expected_at).toISOString().slice(0, 10) : "",
    completed_at: doc.completed_at,
    completedAt: doc.completed_at,
    createdAt: doc.createdAt,
    allocations: (doc.allocations || []).map((log) => ({
      _id: log._id,
      id: log._id?.toString(),
      amount: log.amount,
      account_id: log.account_id,
      accountId: log.account_id?.toString(),
      account_name: log.account_name,
      accountName: log.account_name,
      partition_id: log.partition_id,
      partitionId: log.partition_id?.toString(),
      partition_name: log.partition_name,
      partitionName: log.partition_name,
      currency: log.currency,
      at: log.at,
    })),
    settlements: (doc.settlements || []).map((log) => ({
      _id: log._id,
      id: log._id?.toString(),
      amount: log.amount,
      status: log.status,
      at: log.at,
    })),
  };
};

const sortGoals = (goals) => {
  const rank = (p) => GOAL_PRIORITIES.indexOf(p || "medium");
  return [...goals].sort((a, b) => {
    const rankDiff = rank(a.priority) - rank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    const aExpected = a.expected_at ? new Date(a.expected_at).getTime() : Number.MAX_SAFE_INTEGER;
    const bExpected = b.expected_at ? new Date(b.expected_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (aExpected !== bExpected) return aExpected - bExpected;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
};

const parseGoalBody = (body) => {
  const priority = String(body.priority || "medium").toLowerCase();
  const type = String(body.type || "company").toLowerCase();
  return {
    title: body.title?.trim(),
    target: Number(body.target),
    type: GOAL_TYPES.includes(type) ? type : "company",
    priority: GOAL_PRIORITIES.includes(priority) ? priority : "medium",
    currency: (body.currency || "BDT").trim(),
    expected_at: body.expected_at || body.expectedAt ? new Date(body.expected_at || body.expectedAt) : null,
  };
};

const assertGoalScope = (goalType, partition) => {
  const scope = effectivePartitionScope(partition);
  const allowed =
    goalType === "personal" ? ["owner", "excluded"] : ["business"];
  if (!allowed.includes(scope)) {
    const err = new Error("This partition is not allowed for the selected goal type.");
    err.status = 400;
    throw err;
  }
};

const getGoalOr404 = async (orgId, goalId) => {
  const goal = await FinanceGoal.findOne({ _id: goalId, organization_id: orgId });
  if (!goal) {
    const err = new Error("Goal not found");
    err.status = 404;
    throw err;
  }
  return goal;
};

export const goalList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const goals = await FinanceGoal.find({ organization_id: orgId });
    const sorted = sortGoals(goals).map(serializeGoal);
    const totalTarget = sorted.reduce((sum, g) => sum + Number(g.target || 0), 0);
    return res.status(200).json({
      message: "Goals retrieved",
      success: true,
      goals: sorted,
      totalTarget,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const parsed = parseGoalBody(req.body);
    if (!parsed.title || !parsed.target || parsed.target <= 0) {
      return res.status(400).json({ message: "Goal title and target amount are required", success: false });
    }
    const goal = await FinanceGoal.create({
      organization_id: orgId,
      ...parsed,
      allocations: [],
      settlements: [],
      completed_at: null,
    });
    return res.status(201).json({ message: "Goal created", success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalUpdate = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    const parsed = parseGoalBody({ ...goal.toObject(), ...req.body });
    if (!parsed.title || !parsed.target || parsed.target <= 0) {
      return res.status(400).json({ message: "Goal title and target amount are required", success: false });
    }
    goal.title = parsed.title;
    goal.target = parsed.target;
    goal.type = parsed.type;
    goal.priority = parsed.priority;
    goal.currency = parsed.currency;
    goal.expected_at = parsed.expected_at;
    const allocated = goalAllocated(goal);
    goal.completed_at =
      allocated >= goal.target ? goal.completed_at || new Date() : null;
    await goal.save();
    return res.status(200).json({ message: "Goal updated", success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalDelete = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    await goal.deleteOne();
    return res.status(200).json({ message: "Goal deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalAddAllocation = async (req, res) => {
  const { orgId, goalId } = req.params;
  const { account_id, partition_id, amount } = req.body;
  const amt = Number(amount);
  if (!account_id || !partition_id || !amt || amt <= 0) {
    return res.status(400).json({ message: "Account, partition, and amount are required", success: false });
  }
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    const partition = await assertPartitionInAccount(partition_id, account_id, orgId);
    assertGoalScope(goal.type, partition);
    const account = await FinancialAccount.findOne({ _id: account_id, organization_id: orgId });
    const { available } = await getPartitionAvailableBalance(partition_id, orgId);
    if (amt > available) {
      return res.status(400).json({
        message: `Not enough free money in this partition. Available: ${available}`,
        success: false,
      });
    }
    const now = new Date();
    goal.allocations.unshift({
      amount: amt,
      account_id,
      partition_id,
      account_name: account?.name || "",
      partition_name: partition.name || "",
      currency: account?.currency || goal.currency || "BDT",
      at: now,
    });
    const total = goalAllocated(goal);
    if (total >= goal.target && !goal.completed_at) goal.completed_at = now;
    await goal.save();
    return res.status(200).json({ message: "Allocation added", success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalUpdateAllocation = async (req, res) => {
  const { orgId, goalId, allocationId } = req.params;
  const amt = Number(req.body.amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid amount is required", success: false });
  }
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    const allocation = goal.allocations.id(allocationId);
    if (!allocation) {
      return res.status(404).json({ message: "Allocation not found", success: false });
    }
    const partition = await assertPartitionInAccount(
      allocation.partition_id,
      allocation.account_id,
      orgId
    );
    const { available } = await getPartitionAvailableBalance(allocation.partition_id, orgId, {
      excludeAllocationId: allocationId,
    });
    if (amt > available) {
      return res.status(400).json({
        message: `Cannot save. Max allocation is ${available} for this partition.`,
        success: false,
      });
    }
    allocation.amount = amt;
    const total = goalAllocated(goal);
    if (total >= goal.target && !goal.completed_at) goal.completed_at = new Date();
    if (total < goal.target) goal.completed_at = null;
    await goal.save();
    return res.status(200).json({ message: "Allocation updated", success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalDeleteAllocation = async (req, res) => {
  const { orgId, goalId, allocationId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    const allocation = goal.allocations.id(allocationId);
    if (!allocation) {
      return res.status(404).json({ message: "Allocation not found", success: false });
    }
    allocation.deleteOne();
    const total = goalAllocated(goal);
    if (total < goal.target) goal.completed_at = null;
    await goal.save();
    return res.status(200).json({ message: "Allocation deleted", success: true, goal: serializeGoal(goal) });
  } catch (error) {
    return handleError(res, error);
  }
};

const remainingAllocationSlices = (goal) => {
  const allocations = [...(goal.allocations || [])].reverse();
  let settledRemaining = goalSettled(goal);
  const remaining = [];
  for (const log of allocations) {
    const amount = Number(log.amount || 0);
    if (!log.partition_id || amount <= 0) continue;
    const consumed = Math.min(settledRemaining, amount);
    settledRemaining -= consumed;
    const available = amount - consumed;
    if (available <= 0) continue;
    remaining.push({ allocation: log, amount: available });
  }
  return remaining;
};

export const goalSettle = async (req, res) => {
  const { orgId, goalId } = req.params;
  const amount = Number(req.body.amount);
  const status = GOAL_SETTLEMENT_STATUSES.includes(req.body.status) ? req.body.status : "bought";
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Settlement amount must be greater than zero", success: false });
  }
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await getGoalOr404(orgId, goalId);
    const reserved = goalReserved(goal);
    if (amount > reserved) {
      return res.status(400).json({ message: "Settlement amount cannot exceed reserved money", success: false });
    }
    const slices = remainingAllocationSlices(goal);
    let remainingToDeduct = amount;
    const expenseChunks = [];
    for (const slice of slices) {
      if (remainingToDeduct <= 0) break;
      const chunk = Math.min(remainingToDeduct, slice.amount);
      remainingToDeduct -= chunk;
      expenseChunks.push({ allocation: slice.allocation, amount: chunk });
    }
    if (remainingToDeduct > 0) {
      return res.status(400).json({
        message: "Could not map settlement to allocated partitions",
        success: false,
      });
    }

    const categoryName = await resolveCategoryName(orgId, "expense", "Misc");
    const expenseDate = new Date();
    let applied = 0;

    await withTransaction(async (session) => {
      for (const chunk of expenseChunks) {
        const partition = await assertPartitionInAccount(
          chunk.allocation.partition_id,
          chunk.allocation.account_id,
          orgId
        );
        assertGoalScope(goal.type, partition);
        await applyPartitionDelta(chunk.allocation.partition_id, -chunk.amount, session);
        const doc = new ExpenseTransaction({
          organization_id: orgId,
          account_id: chunk.allocation.account_id,
          partition_id: chunk.allocation.partition_id,
          amount: chunk.amount,
          category: categoryName,
          expense_date: expenseDate,
          is_personal: goal.type === "personal",
          notes: `Goal settlement: ${goal.title} (${status})`,
        });
        await doc.save({ session });
        applied += chunk.amount;
      }
      goal.settlements.unshift({
        amount: applied,
        status,
        at: expenseDate,
      });
      await goal.save({ session });
    });

    return res.status(200).json({
      message: "Goal settled and expense recorded",
      success: true,
      goal: serializeGoal(goal),
      settledAmount: applied,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
