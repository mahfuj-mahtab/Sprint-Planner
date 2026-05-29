import DebtRecord from "../models/debtRecord.models.js";
import FinancialAccount from "../models/financialAccount.models.js";
import Partition from "../models/partition.models.js";
import { toObjectId } from "../utils/mongoIds.js";
import { assertCanAccessFinance, assertCanWriteOrg } from "../utils/orgAccess.js";
import { redactDebtListResponse, redactDebtRecord } from "../utils/financeRedact.js";
import { assertPartitionInAccount } from "./finance.controllers.js";
import { applyPartitionDelta, withTransaction } from "../utils/partitionBalance.js";
import { getPartitionAvailableBalance } from "../utils/goalReserved.js";
import { isDebtLent, parseDebtDirection } from "../constants/debt.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
  });
};

const getDebtOr404 = async (orgId, debtId) => {
  const debt = await DebtRecord.findOne({ _id: debtId, organization_id: orgId });
  if (!debt) {
    const err = new Error("Debt record not found");
    err.status = 404;
    throw err;
  }
  return debt;
};

/** Partition delta when opening a debt (lent = cash out, borrowed = cash in). */
const createDelta = (direction, amount) => (isDebtLent({ direction }) ? -amount : amount);

/** Partition delta when recording a repayment. */
const repayDelta = (direction, amount) => (isDebtLent({ direction }) ? amount : -amount);

/** Partition delta when deleting an open debt (reverse principal effect net of repayments). */
const deleteOpenDelta = (direction, outstanding) =>
  isDebtLent({ direction }) ? outstanding : -outstanding;

/** Partition delta when undoing a repayment. */
const undoRepayDelta = (direction, amount) => (isDebtLent({ direction }) ? -amount : amount);

const serializeDebt = (debt, names = {}) => {
  const doc = debt.toObject ? debt.toObject() : debt;
  const direction = parseDebtDirection(doc.direction);
  const repaid = (doc.repayments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    _id: doc._id,
    id: doc._id?.toString(),
    direction,
    account_id: doc.account_id,
    accountId: doc.account_id?.toString(),
    account_name: names.account_name || doc.account_name || "",
    accountName: names.account_name || doc.account_name || "",
    partition_id: doc.partition_id,
    partitionId: doc.partition_id?.toString(),
    partition_name: names.partition_name || doc.partition_name || "",
    partitionName: names.partition_name || doc.partition_name || "",
    counterparty_name: doc.counterparty_name,
    counterpartyName: doc.counterparty_name,
    principal: doc.principal,
    outstanding: doc.outstanding,
    repaid,
    lent_at: doc.lent_at,
    lentAt: doc.lent_at ? new Date(doc.lent_at).toISOString().slice(0, 10) : "",
    notes: doc.notes || "",
    status: doc.status,
    repayments: (doc.repayments || []).map((r) => ({
      _id: r._id,
      id: r._id?.toString(),
      amount: r.amount,
      repaid_at: r.repaid_at,
      repaidAt: r.repaid_at ? new Date(r.repaid_at).toISOString().slice(0, 10) : "",
      notes: r.notes || "",
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const enrichDebts = async (debts) => {
  const accountIds = [...new Set(debts.map((d) => d.account_id?.toString()).filter(Boolean))];
  const partitionIds = [...new Set(debts.map((d) => d.partition_id?.toString()).filter(Boolean))];
  const [accounts, partitions] = await Promise.all([
    FinancialAccount.find({ _id: { $in: accountIds } }).select("name"),
    Partition.find({ _id: { $in: partitionIds } }).select("name"),
  ]);
  const accountNames = Object.fromEntries(accounts.map((a) => [a._id.toString(), a.name]));
  const partitionNames = Object.fromEntries(partitions.map((p) => [p._id.toString(), p.name]));
  return debts.map((d) =>
    serializeDebt(d, {
      account_name: accountNames[d.account_id?.toString()] || "",
      partition_name: partitionNames[d.partition_id?.toString()] || "",
    })
  );
};

const summarizeDebts = (serialized) => {
  let totalReceivable = 0;
  let totalPayable = 0;
  let openCount = 0;
  for (const d of serialized) {
    if (d.status !== "open") continue;
    openCount += 1;
    const out = Number(d.outstanding || 0);
    if (d.direction === "borrowed") totalPayable += out;
    else totalReceivable += out;
  }
  return { totalReceivable, totalPayable, openCount, totalOutstanding: totalReceivable };
};

export const debtList = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await assertCanAccessFinance(orgId, req.user._id);
    const debts = await DebtRecord.find({ organization_id: orgId }).sort({ lent_at: -1, createdAt: -1 });
    const serialized = await enrichDebts(debts);
    const summary = summarizeDebts(serialized);
    const payload = redactDebtListResponse(
      {
        message: "Debts retrieved",
        success: true,
        debts: serialized,
        ...summary,
      },
      access.canSeeExactAmounts
    );
    return res.status(200).json(payload);
  } catch (error) {
    return handleError(res, error);
  }
};

export const debtCreate = async (req, res) => {
  const { orgId } = req.params;
  const { account_id, partition_id, counterparty_name, amount, lent_at, notes, direction: rawDirection } =
    req.body;
  const direction = parseDebtDirection(rawDirection);
  const amt = Number(amount);
  const name = (counterparty_name || "").trim();

  if (!account_id || !partition_id || !name || !amt || amt <= 0) {
    return res.status(400).json({
      message: "Account, partition, counterparty name, and amount are required",
      success: false,
    });
  }

  try {
    const { access } = await assertCanWriteOrg(orgId, req.user._id);
    await assertPartitionInAccount(partition_id, account_id, orgId);

    if (direction === "lent") {
      const { available } = await getPartitionAvailableBalance(partition_id, orgId);
      if (amt > available) {
        return res.status(400).json({
          message: `Not enough free money in this partition. Available: ${available}`,
          success: false,
          available,
        });
      }
    }

    const lentDate = lent_at ? new Date(lent_at) : new Date();
    let debt;

    await withTransaction(async (session) => {
      await applyPartitionDelta(partition_id, createDelta(direction, amt), session);
      debt = new DebtRecord({
        organization_id: orgId,
        account_id,
        partition_id,
        direction,
        counterparty_name: name,
        principal: amt,
        outstanding: amt,
        lent_at: lentDate,
        notes: (notes || "").trim(),
        status: "open",
        repayments: [],
      });
      await debt.save({ session });
    });

    const [serialized] = await enrichDebts([debt]);
    const message = direction === "borrowed" ? "Borrowing recorded" : "Loan recorded";
    return res.status(201).json({
      message,
      success: true,
      debt: redactDebtRecord(serialized, access.canSeeExactAmounts),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const debtUpdate = async (req, res) => {
  const { orgId, debtId } = req.params;
  try {
    const { access } = await assertCanWriteOrg(orgId, req.user._id);
    const debt = await getDebtOr404(orgId, debtId);
    if (req.body.counterparty_name != null) {
      const name = String(req.body.counterparty_name).trim();
      if (!name) {
        return res.status(400).json({ message: "Counterparty name is required", success: false });
      }
      debt.counterparty_name = name;
    }
    if (typeof req.body.notes === "string") debt.notes = req.body.notes.trim();
    if (req.body.lent_at || req.body.lentAt) {
      debt.lent_at = new Date(req.body.lent_at || req.body.lentAt);
    }
    await debt.save();
    const [serialized] = await enrichDebts([debt]);
    return res.status(200).json({
      message: "Debt updated",
      success: true,
      debt: redactDebtRecord(serialized, access.canSeeExactAmounts),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const debtDelete = async (req, res) => {
  const { orgId, debtId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const debt = await getDebtOr404(orgId, debtId);
    const outstanding = Number(debt.outstanding || 0);
    const direction = parseDebtDirection(debt.direction);

    await withTransaction(async (session) => {
      if (outstanding > 0) {
        await applyPartitionDelta(
          debt.partition_id,
          deleteOpenDelta(direction, outstanding),
          session
        );
      }
      await DebtRecord.deleteOne({ _id: debtId }, { session });
    });

    return res.status(200).json({ message: "Debt removed and balance adjusted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const debtRepay = async (req, res) => {
  const { orgId, debtId } = req.params;
  const amt = Number(req.body.amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid repayment amount is required", success: false });
  }

  try {
    const { access } = await assertCanWriteOrg(orgId, req.user._id);
    const debt = await getDebtOr404(orgId, debtId);
    const direction = parseDebtDirection(debt.direction);
    const outstanding = Number(debt.outstanding || 0);
    if (amt > outstanding) {
      return res.status(400).json({
        message: `Repayment cannot exceed outstanding balance (${outstanding})`,
        success: false,
      });
    }

    if (direction === "borrowed") {
      const { available } = await getPartitionAvailableBalance(debt.partition_id, orgId);
      if (amt > available) {
        return res.status(400).json({
          message: `Not enough free money to repay. Available: ${available}`,
          success: false,
          available,
        });
      }
    }

    const repaidAt = req.body.repaid_at || req.body.repaidAt ? new Date(req.body.repaid_at || req.body.repaidAt) : new Date();

    await withTransaction(async (session) => {
      await applyPartitionDelta(debt.partition_id, repayDelta(direction, amt), session);
      debt.repayments.unshift({
        amount: amt,
        repaid_at: repaidAt,
        notes: (req.body.notes || "").trim(),
      });
      debt.outstanding = outstanding - amt;
      debt.status = debt.outstanding <= 0 ? "settled" : "open";
      await debt.save({ session });
    });

    const [serialized] = await enrichDebts([debt]);
    return res.status(200).json({
      message: "Repayment recorded",
      success: true,
      debt: redactDebtRecord(serialized, access.canSeeExactAmounts),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const debtRepaymentDelete = async (req, res) => {
  const { orgId, debtId, repaymentId } = req.params;
  try {
    const { access } = await assertCanWriteOrg(orgId, req.user._id);
    const debt = await getDebtOr404(orgId, debtId);
    const direction = parseDebtDirection(debt.direction);
    const repayment = debt.repayments.id(repaymentId);
    if (!repayment) {
      return res.status(404).json({ message: "Repayment not found", success: false });
    }
    const amt = Number(repayment.amount || 0);

    await withTransaction(async (session) => {
      await applyPartitionDelta(debt.partition_id, undoRepayDelta(direction, amt), session);
      repayment.deleteOne();
      debt.outstanding = Number(debt.outstanding || 0) + amt;
      debt.status = debt.outstanding > 0 ? "open" : "settled";
      await debt.save({ session });
    });

    const [serialized] = await enrichDebts([debt]);
    return res.status(200).json({
      message: "Repayment removed",
      success: true,
      debt: redactDebtRecord(serialized, access.canSeeExactAmounts),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const sumDebtTotalsByOrg = async (orgId) => {
  const orgOid = toObjectId(orgId);
  const [receivable, payable] = await Promise.all([
    DebtRecord.aggregate([
      { $match: { organization_id: orgOid, status: "open", direction: { $ne: "borrowed" } } },
      { $group: { _id: null, total: { $sum: "$outstanding" } } },
    ]),
    DebtRecord.aggregate([
      { $match: { organization_id: orgOid, status: "open", direction: "borrowed" } },
      { $group: { _id: null, total: { $sum: "$outstanding" } } },
    ]),
  ]);
  const debtReceivable = receivable[0]?.total || 0;
  const debtPayable = payable[0]?.total || 0;
  return { debtReceivable, debtPayable, debtOutstanding: debtReceivable };
};

/** @deprecated use sumDebtTotalsByOrg */
export const sumOutstandingDebtByOrg = async (orgId) => {
  const { debtReceivable } = await sumDebtTotalsByOrg(orgId);
  return debtReceivable;
};
