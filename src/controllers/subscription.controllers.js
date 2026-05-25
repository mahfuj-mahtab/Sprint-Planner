import Subscription from "../models/subscription.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import Partition from "../models/partition.models.js";
import { getOrgForMember } from "../utils/orgAccess.js";
import { applyPartitionDelta, withTransaction } from "../utils/partitionBalance.js";
import {
  advanceDueDate,
  isSubscriptionDue,
  startOfDay,
  BILLING_INTERVALS,
} from "../utils/subscriptionSchedule.js";
import {
  resolveCategoryName,
  resolveProjectId,
  assertPartitionInAccount,
} from "./finance.controllers.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
  });
};

const populateOpts = [
  { path: "account_id", select: "name type currency" },
  { path: "partition_id", select: "name balance" },
  { path: "project_id", select: "name" },
];

const chargeSubscription = async (sub, orgId, session) => {
  const partition = await Partition.findById(sub.partition_id).session(session);
  if (!partition) {
    const err = new Error("Partition not found");
    err.status = 404;
    throw err;
  }
  if (Number(partition.balance) < Number(sub.amount)) {
    const err = new Error("Insufficient partition balance");
    err.status = 400;
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  await applyPartitionDelta(sub.partition_id, -Number(sub.amount), session);

  const expense = new ExpenseTransaction({
    organization_id: orgId,
    account_id: sub.account_id,
    partition_id: sub.partition_id,
    amount: sub.amount,
    category: sub.category,
    project_id: sub.project_id,
    expense_date: startOfDay(new Date()),
    is_personal: false,
    recurring: true,
    notes: `Subscription: ${sub.name}${sub.notes ? ` — ${sub.notes}` : ""}`,
  });
  await expense.save({ session });

  const cycleDue = startOfDay(sub.next_due_date);
  sub.last_charged_at = new Date();
  sub.next_due_date = advanceDueDate(cycleDue, sub.billing_interval, sub.custom_interval_days);
  await sub.save({ session });

  return { expense, subscription: sub };
};

export const processDueSubscriptions = async (orgId) => {
  const subs = await Subscription.find({ organization_id: orgId, is_active: true });
  const results = [];

  for (const sub of subs) {
    if (!isSubscriptionDue(sub)) continue;
    try {
      await withTransaction(async (session) => {
        let fresh = await Subscription.findById(sub._id).session(session);
        let cycles = 0;
        while (fresh && isSubscriptionDue(fresh) && cycles < 24) {
          await chargeSubscription(fresh, orgId, session);
          cycles++;
          fresh = await Subscription.findById(sub._id).session(session);
        }
        if (cycles > 0) {
          results.push({ subscriptionId: sub._id, name: sub.name, status: "charged", cycles });
        }
      });
    } catch (error) {
      results.push({
        subscriptionId: sub._id,
        name: sub.name,
        status: error.code === "INSUFFICIENT_BALANCE" ? "insufficient_balance" : "failed",
        message: error.message,
      });
    }
  }

  return results;
};

export const subscriptionList = async (req, res) => {
  const { orgId } = req.params;
  const runProcess = req.query.process !== "false";

  try {
    await getOrgForMember(orgId, req.user._id);
    let processed = [];
    if (runProcess) {
      processed = await processDueSubscriptions(orgId);
    }

    const subscriptions = await Subscription.find({ organization_id: orgId })
      .sort({ next_due_date: 1 })
      .populate(populateOpts);

    return res.status(200).json({
      message: "Subscriptions retrieved",
      success: true,
      subscriptions,
      processed,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const subscriptionCreate = async (req, res) => {
  const { orgId } = req.params;
  const {
    name,
    amount,
    category,
    account_id,
    partition_id,
    project_id,
    billing_interval,
    custom_interval_days,
    next_due_date,
    is_active,
    auto_deduct,
    notes,
  } = req.body;

  const amt = Number(amount);
  if (!name?.trim()) {
    return res.status(400).json({ message: "Name is required", success: false });
  }
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid amount is required", success: false });
  }
  if (!account_id || !partition_id) {
    return res.status(400).json({ message: "Account and partition are required", success: false });
  }
  if (!next_due_date) {
    return res.status(400).json({ message: "Next due date is required", success: false });
  }

  const interval = BILLING_INTERVALS.includes(billing_interval) ? billing_interval : "monthly";

  try {
    await getOrgForMember(orgId, req.user._id);
    await assertPartitionInAccount(partition_id, account_id, orgId);
    const categoryName = await resolveCategoryName(orgId, "subscription", category || "Other subscription");
    const resolvedProjectId = await resolveProjectId(project_id, orgId);

    const sub = await Subscription.create({
      organization_id: orgId,
      name: name.trim(),
      amount: amt,
      category: categoryName,
      account_id,
      partition_id,
      project_id: resolvedProjectId,
      billing_interval: interval,
      custom_interval_days: interval === "custom" ? Math.max(1, Number(custom_interval_days) || 30) : 30,
      next_due_date: startOfDay(new Date(next_due_date)),
      is_active: is_active !== false,
      auto_deduct: auto_deduct !== false,
      notes: (notes || "").trim(),
    });

    const populated = await Subscription.findById(sub._id).populate(populateOpts);
    return res.status(201).json({ message: "Subscription created", success: true, subscription: populated });
  } catch (error) {
    return handleError(res, error);
  }
};

export const subscriptionUpdate = async (req, res) => {
  const { orgId, subscriptionId } = req.params;
  const body = req.body;

  try {
    await getOrgForMember(orgId, req.user._id);
    const sub = await Subscription.findOne({ _id: subscriptionId, organization_id: orgId });
    if (!sub) {
      return res.status(404).json({ message: "Subscription not found", success: false });
    }

    if (body.name != null) sub.name = String(body.name).trim();
    if (body.amount != null) {
      const amt = Number(body.amount);
      if (!amt || amt <= 0) {
        return res.status(400).json({ message: "Valid amount is required", success: false });
      }
      sub.amount = amt;
    }
    if (body.category) sub.category = await resolveCategoryName(orgId, "subscription", body.category);
    if (body.account_id && body.partition_id) {
      await assertPartitionInAccount(body.partition_id, body.account_id, orgId);
      sub.account_id = body.account_id;
      sub.partition_id = body.partition_id;
    } else if (body.partition_id) {
      await assertPartitionInAccount(body.partition_id, sub.account_id, orgId);
      sub.partition_id = body.partition_id;
    }
    if (body.project_id !== undefined) {
      sub.project_id = await resolveProjectId(body.project_id, orgId);
    }
    if (body.billing_interval && BILLING_INTERVALS.includes(body.billing_interval)) {
      sub.billing_interval = body.billing_interval;
    }
    if (body.custom_interval_days != null) {
      sub.custom_interval_days = Math.max(1, Number(body.custom_interval_days) || 30);
    }
    if (body.next_due_date) sub.next_due_date = startOfDay(new Date(body.next_due_date));
    if (typeof body.is_active === "boolean") sub.is_active = body.is_active;
    if (typeof body.auto_deduct === "boolean") sub.auto_deduct = body.auto_deduct;
    if (typeof body.notes === "string") sub.notes = body.notes.trim();

    await sub.save();
    const populated = await Subscription.findById(sub._id).populate(populateOpts);
    return res.status(200).json({ message: "Subscription updated", success: true, subscription: populated });
  } catch (error) {
    return handleError(res, error);
  }
};

export const subscriptionDelete = async (req, res) => {
  const { orgId, subscriptionId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const sub = await Subscription.findOneAndDelete({ _id: subscriptionId, organization_id: orgId });
    if (!sub) {
      return res.status(404).json({ message: "Subscription not found", success: false });
    }
    return res.status(200).json({ message: "Subscription deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const subscriptionChargeNow = async (req, res) => {
  const { orgId, subscriptionId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const result = await withTransaction(async (session) => {
      const sub = await Subscription.findOne({ _id: subscriptionId, organization_id: orgId }).session(session);
      if (!sub) {
        const err = new Error("Subscription not found");
        err.status = 404;
        throw err;
      }
      if (!sub.is_active) {
        const err = new Error("Subscription is paused");
        err.status = 400;
        throw err;
      }
      await assertPartitionInAccount(sub.partition_id, sub.account_id, orgId);
      return chargeSubscription(sub, orgId, session);
    });

    const populated = await Subscription.findById(subscriptionId).populate(populateOpts);
    return res.status(200).json({
      message: "Subscription charged",
      success: true,
      subscription: populated,
      expense: result.expense,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const subscriptionProcessDue = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const processed = await processDueSubscriptions(orgId);
    return res.status(200).json({ message: "Due subscriptions processed", success: true, processed });
  } catch (error) {
    return handleError(res, error);
  }
};
