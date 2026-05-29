import Investor from "../models/investor.models.js";
import InvestmentTransaction from "../models/investmentTransaction.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import FinancialAccount from "../models/financialAccount.models.js";
import Partition from "../models/partition.models.js";
import {
  assertCanAccessFinance,
  assertCanWriteOrg,
} from "../utils/orgAccess.js";
import { toObjectId } from "../utils/mongoIds.js";
import {
  applyPartitionDelta,
  validateAllocations,
  withTransaction,
} from "../utils/partitionBalance.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const assertPartitionInAccount = async (partitionId, accountId, orgId) => {
  const partition = await Partition.findOne({
    _id: partitionId,
    account_id: accountId,
    organization_id: orgId,
  });
  if (!partition) {
    const err = new Error("Partition not found for this account");
    err.status = 404;
    throw err;
  }
  return partition;
};

const resolveInvestmentAllocations = async ({ orgId, account_id, amount, partition_allocations }) => {
  const investmentAmount = Number(amount);
  let allocations = partition_allocations;

  if (!allocations?.length) {
    const defaultPartition = await Partition.findOne({
      account_id,
      organization_id: orgId,
      is_default: true,
    });

    if (!defaultPartition) {
      const err = new Error("No default partition; select a partition");
      err.status = 400;
      throw err;
    }

    allocations = [{ partition_id: defaultPartition._id, amount: investmentAmount }];
  }

  validateAllocations(investmentAmount, allocations);

  for (const allocation of allocations) {
    await assertPartitionInAccount(allocation.partition_id, account_id, orgId);
  }

  return allocations.map((allocation) => ({
    partition_id: allocation.partition_id,
    amount: Number(allocation.amount),
  }));
};

const reverseInvestmentAllocations = async (transaction, session = null) => {
  let allocationsToReverse = transaction.allocations || [];
  let linkedIncomeTx = null;

  if (!allocationsToReverse.length && transaction.income_transaction_id) {
    linkedIncomeTx = await IncomeTransaction.findById(transaction.income_transaction_id).session(session);
    allocationsToReverse = linkedIncomeTx?.allocations || [];
  }

  for (const allocation of allocationsToReverse) {
    await applyPartitionDelta(allocation.partition_id, -Number(allocation.amount), session);
  }

  if (linkedIncomeTx) {
    await IncomeTransaction.deleteOne({ _id: linkedIncomeTx._id }).session(session);
  }
};

const syncInvestorTotals = async (orgId, investorId, session = null) => {
  const opts = session ? { session } : {};
  const match = {
    organization_id: toObjectId(orgId) || orgId,
    investor_id: toObjectId(investorId) || investorId,
    transaction_type: "investment",
  };

  let aggregate = InvestmentTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$investor_id",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);
  if (session) aggregate = aggregate.session(session);

  const [result] = await aggregate;

  await Investor.updateOne(
    { _id: investorId, organization_id: orgId },
    {
      $set: {
        total_invested: Number(result?.total || 0),
        investment_count: Number(result?.count || 0),
      },
    },
    opts
  );
};

const getInvestorStatsMap = async (orgId) => {
  const stats = await InvestmentTransaction.aggregate([
    {
      $match: {
        organization_id: toObjectId(orgId) || orgId,
        transaction_type: "investment",
      },
    },
    {
      $group: {
        _id: "$investor_id",
        total_invested: { $sum: "$amount" },
        investment_count: { $sum: 1 },
      },
    },
  ]);

  return stats.reduce((map, item) => {
    map[item._id.toString()] = {
      total_invested: Number(item.total_invested || 0),
      investment_count: Number(item.investment_count || 0),
    };
    return map;
  }, {});
};

const withComputedInvestorTotals = (investor, statsMap) => {
  const object = typeof investor.toObject === "function" ? investor.toObject() : investor;
  const stats = statsMap[object._id.toString()] || {
    total_invested: 0,
    investment_count: 0,
  };

  return {
    ...object,
    total_invested: stats.total_invested,
    investment_count: stats.investment_count,
  };
};

const getCurrencyTotals = (transactions) => {
  const totals = transactions.reduce((map, transaction) => {
    const currency = transaction.currency || "BDT";
    map[currency] = (map[currency] || 0) + Number(transaction.amount || 0);
    return map;
  }, {});
  const entries = Object.entries(totals).map(([currency, amount]) => ({ currency, amount }));
  const primary = entries.sort((a, b) => b.amount - a.amount)[0];

  return {
    totalsByCurrency: entries,
    primaryCurrency: primary?.currency || "BDT",
    primaryTotal: primary?.amount || 0,
  };
};

// ===== INVESTOR CRUD =====

/**
 * Get all investors for organization
 */
export const investorList = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;

    await assertCanWriteOrg(orgId, userId);

    const investors = await Investor.find({ organization_id: orgId }).sort({ createdAt: -1 });
    const statsMap = await getInvestorStatsMap(orgId);
    const investorsWithTotals = investors.map((investor) =>
      withComputedInvestorTotals(investor, statsMap)
    );

    return res.status(200).json({
      success: true,
      data: investorsWithTotals,
      total: investorsWithTotals.length,
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Get single investor with investment history
 */
export const investorGet = async (req, res) => {
  try {
    const { orgId, investorId } = req.params;
    const userId = req.user._id;

    await assertCanAccessFinance(orgId, userId);

    const investor = await Investor.findOne({
      _id: investorId,
      organization_id: orgId,
    });

    if (!investor) {
      const err = new Error("Investor not found");
      err.status = 404;
      throw err;
    }
    const statsMap = await getInvestorStatsMap(orgId);
    const investorWithTotals = withComputedInvestorTotals(investor, statsMap);

    // Get investment history
    const transactions = await InvestmentTransaction.find({
      investor_id: investorId,
      organization_id: orgId,
    })
      .sort({ investment_date: -1 })
      .populate("account_id", "name");

    return res.status(200).json({
      success: true,
      data: {
        ...investorWithTotals,
        transactions,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Create new investor
 */
export const investorCreate = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;
    const { name, email, phone, investor_type, ownership_percentage, notes } = req.body;

    await assertCanWriteOrg(orgId, userId);

    // Validate ownership percentage
    if (ownership_percentage < 0 || ownership_percentage > 100) {
      const err = new Error("Ownership percentage must be between 0 and 100");
      err.status = 400;
      throw err;
    }

    const investor = new Investor({
      organization_id: orgId,
      name: name.trim(),
      email: email?.trim().toLowerCase(),
      phone: phone?.trim(),
      investor_type: investor_type || "individual",
      ownership_percentage,
      notes: notes?.trim(),
    });

    await investor.save();

    return res.status(201).json({
      success: true,
      data: investor,
      message: "Investor created successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Update investor details
 */
export const investorUpdate = async (req, res) => {
  try {
    const { orgId, investorId } = req.params;
    const userId = req.user._id;
    const { name, email, phone, investor_type, ownership_percentage, status, notes } = req.body;

    await assertCanWriteOrg(orgId, userId);

    const investor = await Investor.findOne({
      _id: investorId,
      organization_id: orgId,
    });

    if (!investor) {
      const err = new Error("Investor not found");
      err.status = 404;
      throw err;
    }

    // Validate ownership percentage if provided
    if (ownership_percentage !== undefined) {
      if (ownership_percentage < 0 || ownership_percentage > 100) {
        const err = new Error("Ownership percentage must be between 0 and 100");
        err.status = 400;
        throw err;
      }
      investor.ownership_percentage = ownership_percentage;
    }

    if (name !== undefined) investor.name = name.trim();
    if (email !== undefined) investor.email = email?.trim().toLowerCase();
    if (phone !== undefined) investor.phone = phone?.trim();
    if (investor_type !== undefined) investor.investor_type = investor_type;
    if (status !== undefined) investor.status = status;
    if (notes !== undefined) investor.notes = notes?.trim();

    await investor.save();

    return res.status(200).json({
      success: true,
      data: investor,
      message: "Investor updated successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Delete investor (soft delete by status)
 */
export const investorDelete = async (req, res) => {
  try {
    const { orgId, investorId } = req.params;
    const userId = req.user._id;

    await assertCanWriteOrg(orgId, userId);

    const investor = await Investor.findOne({
      _id: investorId,
      organization_id: orgId,
    });

    if (!investor) {
      const err = new Error("Investor not found");
      err.status = 404;
      throw err;
    }

    // Check if investor has transactions
    const hasTransactions = await InvestmentTransaction.countDocuments({
      investor_id: investorId,
    });

    if (hasTransactions > 0) {
      // Mark as inactive instead of deleting
      investor.status = "inactive";
      await investor.save();
      return res.status(200).json({
        success: true,
        message: "Investor marked as inactive (has transaction history)",
        data: investor,
      });
    }

    await Investor.deleteOne({ _id: investorId });

    return res.status(200).json({
      success: true,
      message: "Investor deleted successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

// ===== INVESTMENT TRANSACTION OPERATIONS =====

/**
 * Record investment amount from investor
 * This records capital funding and updates the selected partition balance.
 */
export const investmentCreate = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;
    const {
      investor_id,
      account_id,
      amount,
      investment_date,
      payment_method,
      reference_number,
      notes,
      partition_allocations, // Optional: how to allocate across partitions
    } = req.body;

    await assertCanAccessFinance(orgId, userId);

    // Validate investor exists
    const investor = await Investor.findOne({
      _id: investor_id,
      organization_id: orgId,
    });

    if (!investor) {
      const err = new Error("Investor not found");
      err.status = 404;
      throw err;
    }

    // Validate account exists
    const account = await FinancialAccount.findOne({
      _id: account_id,
      organization_id: orgId,
    });

    if (!account) {
      const err = new Error("Financial account not found");
      err.status = 404;
      throw err;
    }

    const investmentAmount = Number(amount);
    if (investmentAmount <= 0) {
      const err = new Error("Investment amount must be greater than 0");
      err.status = 400;
      throw err;
    }

    const investmentAllocations = await resolveInvestmentAllocations({
      orgId,
      account_id,
      amount: investmentAmount,
      partition_allocations,
    });

    const investmentTx = await withTransaction(async (session) => {
      for (const allocation of investmentAllocations) {
        await applyPartitionDelta(allocation.partition_id, allocation.amount, session);
      }

      const investmentTransaction = new InvestmentTransaction({
        organization_id: orgId,
        investor_id,
        account_id,
        amount: investmentAmount,
        allocations: investmentAllocations,
        transaction_type: "investment",
        investment_date: investment_date ? new Date(investment_date) : new Date(),
        currency: account.currency || "BDT",
        payment_method: payment_method || "other",
        reference_number,
        notes: notes?.trim(),
        created_by: userId,
      });

      await investmentTransaction.save(session ? { session } : {});

      await syncInvestorTotals(orgId, investor_id, session);

      return investmentTransaction;
    });

    return res.status(201).json({
      success: true,
      data: {
        investmentTransaction: investmentTx,
      },
      message: "Investment recorded successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Update investment transaction and rebalance partition/investor totals
 */
export const investmentUpdate = async (req, res) => {
  try {
    const { orgId, transactionId } = req.params;
    const userId = req.user._id;
    const {
      investor_id,
      account_id,
      amount,
      investment_date,
      payment_method,
      reference_number,
      notes,
      partition_allocations,
    } = req.body;

    await assertCanWriteOrg(orgId, userId);

    const transaction = await InvestmentTransaction.findOne({
      _id: transactionId,
      organization_id: orgId,
    });

    if (!transaction) {
      const err = new Error("Investment transaction not found");
      err.status = 404;
      throw err;
    }

    const nextInvestorId = investor_id || transaction.investor_id;
    const nextAccountId = account_id || transaction.account_id;
    const nextAmount = Number(amount ?? transaction.amount);

    if (nextAmount <= 0) {
      const err = new Error("Investment amount must be greater than 0");
      err.status = 400;
      throw err;
    }

    const investor = await Investor.findOne({
      _id: nextInvestorId,
      organization_id: orgId,
    });
    if (!investor) {
      const err = new Error("Investor not found");
      err.status = 404;
      throw err;
    }

    const account = await FinancialAccount.findOne({
      _id: nextAccountId,
      organization_id: orgId,
    });
    if (!account) {
      const err = new Error("Financial account not found");
      err.status = 404;
      throw err;
    }

    const nextAllocations = await resolveInvestmentAllocations({
      orgId,
      account_id: nextAccountId,
      amount: nextAmount,
      partition_allocations,
    });

    const previousInvestorId = transaction.investor_id;

    const updatedTransaction = await withTransaction(async (session) => {
      await reverseInvestmentAllocations(transaction, session);

      for (const allocation of nextAllocations) {
        await applyPartitionDelta(allocation.partition_id, allocation.amount, session);
      }

      transaction.investor_id = nextInvestorId;
      transaction.account_id = nextAccountId;
      transaction.amount = nextAmount;
      transaction.allocations = nextAllocations;
      transaction.income_transaction_id = null;
      transaction.investment_date = investment_date ? new Date(investment_date) : transaction.investment_date;
      transaction.currency = account.currency || transaction.currency || "BDT";
      transaction.payment_method = payment_method || transaction.payment_method || "other";
      transaction.reference_number = reference_number ?? transaction.reference_number;
      transaction.notes = notes !== undefined ? notes?.trim() : transaction.notes;

      await transaction.save(session ? { session } : {});
      await syncInvestorTotals(orgId, previousInvestorId, session);
      if (previousInvestorId.toString() !== nextInvestorId.toString()) {
        await syncInvestorTotals(orgId, nextInvestorId, session);
      }

      return transaction;
    });

    return res.status(200).json({
      success: true,
      data: {
        investmentTransaction: updatedTransaction,
      },
      message: "Investment updated successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Get investment transactions for organization
 */
export const investmentTransactionList = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;
    const { investor_id, start_date, end_date } = req.query;

    await assertCanAccessFinance(orgId, userId);

    const filter = { organization_id: orgId };

    if (investor_id) {
      filter.investor_id = investor_id;
    }

    if (start_date || end_date) {
      filter.investment_date = {};
      if (start_date) filter.investment_date.$gte = new Date(start_date);
      if (end_date) filter.investment_date.$lte = new Date(end_date);
    }

    const transactions = await InvestmentTransaction.find(filter)
      .sort({ investment_date: -1 })
      .populate("investor_id", "name email")
      .populate("account_id", "name currency");

    return res.status(200).json({
      success: true,
      data: transactions,
      total: transactions.length,
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Delete investment transaction (and revert investor totals)
 */
export const investmentDelete = async (req, res) => {
  try {
    const { orgId, transactionId } = req.params;
    const userId = req.user._id;

    await assertCanWriteOrg(orgId, userId);

    const transaction = await InvestmentTransaction.findOne({
      _id: transactionId,
      organization_id: orgId,
    });

    if (!transaction) {
      const err = new Error("Investment transaction not found");
      err.status = 404;
      throw err;
    }

    const amount = Number(transaction.amount);
    const investorId = transaction.investor_id;
    await withTransaction(async (session) => {
      await reverseInvestmentAllocations(transaction, session);
      await InvestmentTransaction.deleteOne({ _id: transactionId }).session(session);

      await syncInvestorTotals(orgId, investorId, session);
    });

    return res.status(200).json({
      success: true,
      message: "Investment transaction deleted successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

// ===== INVESTOR DASHBOARD =====

/**
 * Get investor dashboard metrics
 */
export const investorDashboard = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;

    await assertCanAccessFinance(orgId, userId);

    // Get all investors
    const investors = await Investor.find({ organization_id: orgId });

    // Get all investment transactions
    const transactions = await InvestmentTransaction.find({
      organization_id: orgId,
      transaction_type: "investment",
    }).populate("investor_id", "name ownership_percentage");

    // Calculate totals
    const currencyTotals = getCurrencyTotals(transactions);
    const totalRaised = currencyTotals.primaryTotal;

    // Group by investor
    const byInvestor = {};
    const statsMap = await getInvestorStatsMap(orgId);

    for (const investor of investors) {
      const investorWithTotals = withComputedInvestorTotals(investor, statsMap);
      byInvestor[investor._id.toString()] = {
        _id: investor._id,
        name: investor.name,
        email: investor.email,
        investor_type: investor.investor_type,
        ownership_percentage: investor.ownership_percentage,
        status: investor.status,
        total_invested: investorWithTotals.total_invested,
        investment_count: investorWithTotals.investment_count,
        transactions: [],
      };
    }

    // Add transactions to investors
    for (const tx of transactions) {
      const investorId = tx.investor_id._id.toString();
      if (byInvestor[investorId]) {
        byInvestor[investorId].transactions.push({
          _id: tx._id,
          amount: tx.amount,
          investment_date: tx.investment_date,
          payment_method: tx.payment_method,
          reference_number: tx.reference_number,
        });
      }
    }

    const investorList = Object.values(byInvestor);

    // Calculate ownership summary
    const ownershipSummary = investorList.map((inv) => ({
      name: inv.name,
      ownership_percentage: inv.ownership_percentage,
      total_invested: inv.total_invested,
      investment_count: inv.investment_count,
    }));

    // Sum of ownership percentages (should be <= 100)
    const totalOwnershipPercentage = investorList.reduce(
      (sum, inv) => sum + inv.ownership_percentage,
      0
    );

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          total_raised: totalRaised,
          currency: currencyTotals.primaryCurrency,
          totals_by_currency: currencyTotals.totalsByCurrency,
          total_investors: investors.length,
          active_investors: investors.filter((i) => i.status === "active").length,
          total_ownership_allocated: totalOwnershipPercentage,
        },
        investors: investorList,
        ownershipSummary,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Get investor summary (quick stats)
 */
export const investorSummary = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user._id;

    await assertCanAccessFinance(orgId, userId);

    const investors = await Investor.find({
      organization_id: orgId,
      status: "active",
    });

    const transactions = await InvestmentTransaction.find({
      organization_id: orgId,
      transaction_type: "investment",
    });

    const currencyTotals = getCurrencyTotals(transactions);
    const totalRaised = currencyTotals.primaryTotal;
    const investorCount = investors.length;
    const avgInvestment = investorCount > 0 ? totalRaised / investorCount : 0;

    const statsMap = await getInvestorStatsMap(orgId);
    const investorsWithTotals = investors.map((investor) =>
      withComputedInvestorTotals(investor, statsMap)
    );

    const topInvestors = investorsWithTotals
      .sort((a, b) => b.total_invested - a.total_invested)
      .slice(0, 5)
      .map((inv) => ({
        name: inv.name,
        total_invested: inv.total_invested,
        ownership_percentage: inv.ownership_percentage,
      }));

    return res.status(200).json({
      success: true,
      data: {
        totalRaised,
        currency: currencyTotals.primaryCurrency,
        totalsByCurrency: currencyTotals.totalsByCurrency,
        investorCount,
        avgInvestment,
        topInvestors,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};
