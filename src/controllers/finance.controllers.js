import FinancialAccount from "../models/financialAccount.models.js";
import Partition from "../models/partition.models.js";
import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import PartitionTransfer from "../models/partitionTransfer.models.js";
import FinanceCategory from "../models/financeCategory.models.js";
import Project from "../models/project.models.js";
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_SUBSCRIPTION_CATEGORIES,
} from "../constants/defaultFinanceCategories.js";
import Subscription from "../models/subscription.models.js";
import { getOrgForMember, assertOrgOwner } from "../utils/orgAccess.js";
import { toObjectId, sumByProjectId } from "../utils/mongoIds.js";
import {
  applyPartitionDelta,
  validateAllocations,
  withTransaction,
} from "../utils/partitionBalance.js";
import { DEFAULT_PARTITION_SCOPE, PARTITION_SCOPES } from "../constants/partitionScopes.js";
import {
  assertExpensePartitionScope,
  sumBusinessExpenseInRange,
  sumBusinessIncomeInRange,
  sumBalancesByScope,
  getPartitionsByOrg,
  buildPartitionScopeMap,
  sumIncomeAllocationsForScopes,
} from "../utils/partitionFinance.js";
import { resolveIncomeSourceId } from "./incomeSource.controllers.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const monthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const attachAccountBalances = async (accounts) => {
  const accountIds = accounts.map((a) => a._id);
  const partitions = await Partition.find({ account_id: { $in: accountIds } });
  const byAccount = {};
  for (const p of partitions) {
    const key = p.account_id.toString();
    if (!byAccount[key]) byAccount[key] = [];
    byAccount[key].push(p);
  }
  return accounts.map((a) => {
    const parts = byAccount[a._id.toString()] || [];
    const totalBalance = parts.reduce((s, p) => s + Number(p.balance), 0);
    return { ...a.toObject(), partitions: parts, totalBalance };
  });
};

export const resolveProjectId = async (project_id, orgId) => {
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

export const assertPartitionInAccount = async (partitionId, accountId, orgId) => {
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

export const ensureDefaultCategories = async (orgId) => {
  const seedIfEmpty = async (type, names) => {
    const count = await FinanceCategory.countDocuments({ organization_id: orgId, type });
    if (count > 0) return;
    await FinanceCategory.insertMany(
      names.map((name) => ({
        organization_id: orgId,
        name,
        type,
        is_default: true,
      }))
    );
  };
  await seedIfEmpty("income", DEFAULT_INCOME_CATEGORIES);
  await seedIfEmpty("expense", DEFAULT_EXPENSE_CATEGORIES);
  await seedIfEmpty("subscription", DEFAULT_SUBSCRIPTION_CATEGORIES);
};

export const resolveCategoryName = async (orgId, type, categoryName) => {
  await ensureDefaultCategories(orgId);
  const name = (categoryName || "").trim();
  if (!name) {
    const fallback = await FinanceCategory.findOne({ organization_id: orgId, type }).sort({ createdAt: 1 });
    if (fallback) return fallback.name;
    if (type === "income") return "Other income";
    if (type === "subscription") return "Other subscription";
    return "Misc";
  }

  const cat = await FinanceCategory.findOne({
    organization_id: orgId,
    type,
    name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });
  if (!cat) {
    const err = new Error(`Category "${name}" not found. Create it under Categories first.`);
    err.status = 400;
    throw err;
  }
  return cat.name;
};

const resolveIncomeAllocations = async ({ orgId, account_id, amount, allocations, partition_id }) => {
  const amt = Number(amount);
  let finalAllocations = allocations;
  if (!finalAllocations?.length) {
    const partId = partition_id;
    if (partId) {
      finalAllocations = [{ partition_id: partId, amount: amt }];
    } else {
      const defaultPart = await Partition.findOne({ account_id, organization_id: orgId, is_default: true });
      if (!defaultPart) {
        const err = new Error("No default partition; provide allocations");
        err.status = 400;
        throw err;
      }
      finalAllocations = [{ partition_id: defaultPart._id, amount: amt }];
    }
  }
  validateAllocations(amt, finalAllocations);
  for (const a of finalAllocations) {
    await assertPartitionInAccount(a.partition_id, account_id, orgId);
  }
  return finalAllocations.map((a) => ({
    partition_id: a.partition_id,
    amount: Number(a.amount),
  }));
};

export const financeOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    await ensureDefaultCategories(orgId);
    const { start, end } = monthRange();

    const [accounts, businessMonthIncome, businessMonthExpense, activeProjects, partitions] =
      await Promise.all([
        FinancialAccount.find({ organization_id: orgId }),
        sumBusinessIncomeInRange(orgId, start, end),
        sumBusinessExpenseInRange(orgId, start, end),
        Project.countDocuments({ organization_id: orgId, status: "active", isArchived: false }),
        getPartitionsByOrg(orgId),
      ]);

    const accountsWithBalances = await attachAccountBalances(accounts);
    const balanceByScope = sumBalancesByScope(partitions);
    const businessNetProfit = businessMonthIncome - businessMonthExpense;

    return res.status(200).json({
      message: "Finance overview retrieved",
      success: true,
      overview: {
        monthIncome: businessMonthIncome,
        monthExpense: businessMonthExpense,
        netProfit: businessNetProfit,
        businessMonthIncome,
        businessMonthExpense,
        businessNetProfit,
        businessBalance: balanceByScope.business,
        ownerBalance: balanceByScope.owner,
        excludedBalance: balanceByScope.excluded,
        totalBalance: balanceByScope.all,
        activeProjects,
        accounts: accountsWithBalances,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const accountList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const accounts = await FinancialAccount.find({ organization_id: orgId }).sort({ createdAt: 1 });
    const enriched = await attachAccountBalances(accounts);
    return res.status(200).json({ message: "Accounts retrieved", success: true, accounts: enriched });
  } catch (error) {
    return handleError(res, error);
  }
};

export const accountCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name, type, currency, defaultPartitionName } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Account name is required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);

    const account = new FinancialAccount({
      organization_id: orgId,
      name: name.trim(),
      type: type || "bank",
      currency: (currency || "BDT").trim(),
    });
    await account.save();

    const defaultPartition = new Partition({
      organization_id: orgId,
      account_id: account._id,
      name: (defaultPartitionName || "Free Balance").trim(),
      balance: 0,
      is_default: true,
      scope: DEFAULT_PARTITION_SCOPE,
    });
    await defaultPartition.save();

    return res.status(201).json({
      message: "Account created with default partition",
      success: true,
      account: {
        ...account.toObject(),
        partitions: [defaultPartition],
        totalBalance: 0,
      },
    });
  } catch (error) {
    const isDuplicate = error?.code === 11000;
    if (isDuplicate) {
      return res.status(409).json({ message: "An account with this name already exists", success: false });
    }
    return handleError(res, error);
  }
};

export const accountDelete = async (req, res) => {
  const { orgId, accountId } = req.params;
  try {
    await assertOrgOwner(orgId, req.user._id);
    const account = await FinancialAccount.findOneAndDelete({ _id: accountId, organization_id: orgId });
    if (!account) {
      return res.status(404).json({ message: "Account not found", success: false });
    }
    await Partition.deleteMany({ account_id: accountId });
    return res.status(200).json({ message: "Account deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const partitionCreate = async (req, res) => {
  const { orgId, accountId } = req.params;
  const { name, balance, scope } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Partition name is required", success: false });
  }

  const partitionScope = PARTITION_SCOPES.includes(scope) ? scope : DEFAULT_PARTITION_SCOPE;

  try {
    await getOrgForMember(orgId, req.user._id);
    const account = await FinancialAccount.findOne({ _id: accountId, organization_id: orgId });
    if (!account) {
      return res.status(404).json({ message: "Account not found", success: false });
    }

    const partition = new Partition({
      organization_id: orgId,
      account_id: accountId,
      name: name.trim(),
      balance: Math.max(0, Number(balance) || 0),
      is_default: false,
      scope: partitionScope,
    });
    await partition.save();
    return res.status(201).json({ message: "Partition created", success: true, partition });
  } catch (error) {
    const isDuplicate = error?.code === 11000;
    if (isDuplicate) {
      return res.status(409).json({ message: "A partition with this name already exists in this account", success: false });
    }
    return handleError(res, error);
  }
};

export const partitionUpdate = async (req, res) => {
  const { orgId, accountId, partitionId } = req.params;
  const { name, scope } = req.body;

  try {
    await getOrgForMember(orgId, req.user._id);
    const partition = await Partition.findOne({
      _id: partitionId,
      account_id: accountId,
      organization_id: orgId,
    });
    if (!partition) {
      return res.status(404).json({ message: "Partition not found", success: false });
    }

    if (name?.trim()) partition.name = name.trim();
    if (scope && PARTITION_SCOPES.includes(scope)) partition.scope = scope;

    await partition.save();
    return res.status(200).json({ message: "Partition updated", success: true, partition });
  } catch (error) {
    const isDuplicate = error?.code === 11000;
    if (isDuplicate) {
      return res.status(409).json({ message: "A partition with this name already exists in this account", success: false });
    }
    return handleError(res, error);
  }
};

export const incomeCreate = async (req, res) => {
  const { orgId } = req.params;
  const {
    amount,
    category,
    source,
    project_id,
    client_id,
    account_id,
    allocations,
    partition_id,
    payment_date,
    payment_method,
    notes,
    income_source_id,
  } = req.body;

  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid amount is required", success: false });
  }
  if (!account_id) {
    return res.status(400).json({ message: "Account is required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const account = await FinancialAccount.findOne({ _id: account_id, organization_id: orgId });
    if (!account) {
      return res.status(404).json({ message: "Account not found", success: false });
    }

    const categoryName = await resolveCategoryName(orgId, "income", category);
    const resolvedProjectId = await resolveProjectId(project_id, orgId);
    const resolvedIncomeSourceId = await resolveIncomeSourceId(income_source_id, orgId);
    const mappedAllocations = await resolveIncomeAllocations({
      orgId,
      account_id,
      amount: amt,
      allocations,
      partition_id,
    });

    const income = await withTransaction(async (session) => {
      for (const a of mappedAllocations) {
        await applyPartitionDelta(a.partition_id, a.amount, session);
      }

      const doc = new IncomeTransaction({
        organization_id: orgId,
        account_id,
        amount: amt,
        category: categoryName,
        source: source || "other",
        project_id: resolvedProjectId,
        client_id: client_id || null,
        income_source_id: resolvedIncomeSourceId,
        allocations: mappedAllocations,
        payment_date: payment_date ? new Date(payment_date) : new Date(),
        payment_method: payment_method || "other",
        notes: (notes || "").trim(),
      });
      await doc.save({ session });
      return doc;
    });

    return res.status(201).json({ message: "Income recorded", success: true, income });
  } catch (error) {
    return handleError(res, error);
  }
};

export const expenseCreate = async (req, res) => {
  const { orgId } = req.params;
  const {
    amount,
    category,
    project_id,
    account_id,
    partition_id,
    expense_date,
    is_personal,
    recurring,
    notes,
    income_source_id,
  } = req.body;

  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid amount is required", success: false });
  }
  if (!account_id || !partition_id) {
    return res.status(400).json({ message: "Account and partition are required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const partition = await assertPartitionInAccount(partition_id, account_id, orgId);
    assertExpensePartitionScope(partition, Boolean(is_personal));
    const categoryName = await resolveCategoryName(orgId, "expense", category);
    const resolvedProjectId = await resolveProjectId(project_id, orgId);
    const resolvedIncomeSourceId = await resolveIncomeSourceId(income_source_id, orgId);

    const expense = await withTransaction(async (session) => {
      await applyPartitionDelta(partition_id, -amt, session);

      const doc = new ExpenseTransaction({
        organization_id: orgId,
        account_id,
        partition_id,
        amount: amt,
        category: categoryName,
        project_id: resolvedProjectId,
        income_source_id: resolvedIncomeSourceId,
        expense_date: expense_date ? new Date(expense_date) : new Date(),
        is_personal: Boolean(is_personal),
        recurring: Boolean(recurring),
        notes: (notes || "").trim(),
      });
      await doc.save({ session });
      return doc;
    });

    return res.status(201).json({ message: "Expense recorded", success: true, expense });
  } catch (error) {
    return handleError(res, error);
  }
};

export const incomeUpdate = async (req, res) => {
  const { orgId, incomeId } = req.params;
  const body = req.body;

  try {
    await getOrgForMember(orgId, req.user._id);
    const existing = await IncomeTransaction.findOne({ _id: incomeId, organization_id: orgId });
    if (!existing) {
      return res.status(404).json({ message: "Income not found", success: false });
    }

    const account_id = body.account_id || existing.account_id.toString();
    const amt = body.amount != null ? Number(body.amount) : existing.amount;
    if (!amt || amt <= 0) {
      return res.status(400).json({ message: "Valid amount is required", success: false });
    }

    const partition_id = body.partition_id || existing.allocations?.[0]?.partition_id?.toString();
    let categoryName = existing.category;
    if (body.category) {
      categoryName = await resolveCategoryName(orgId, "income", body.category);
    }

    const mappedAllocations = await resolveIncomeAllocations({
      orgId,
      account_id,
      amount: amt,
      allocations: body.allocations,
      partition_id,
    });

    const income = await withTransaction(async (session) => {
      for (const a of existing.allocations) {
        await applyPartitionDelta(a.partition_id, -Number(a.amount), session);
      }
      for (const a of mappedAllocations) {
        await applyPartitionDelta(a.partition_id, a.amount, session);
      }

      if (body.amount != null) existing.amount = amt;
      existing.category = categoryName;
      if (body.source) existing.source = body.source;
      if (body.account_id) existing.account_id = account_id;
      if (body.project_id !== undefined) {
        existing.project_id = await resolveProjectId(body.project_id, orgId);
      }
      if (body.client_id !== undefined) existing.client_id = body.client_id || null;
      if (body.income_source_id !== undefined) {
        existing.income_source_id = await resolveIncomeSourceId(body.income_source_id, orgId);
      }
      if (body.payment_date) existing.payment_date = new Date(body.payment_date);
      if (body.payment_method) existing.payment_method = body.payment_method;
      if (typeof body.notes === "string") existing.notes = body.notes.trim();
      existing.allocations = mappedAllocations;
      await existing.save({ session });
      return existing;
    });

    return res.status(200).json({ message: "Income updated", success: true, income });
  } catch (error) {
    return handleError(res, error);
  }
};

export const incomeDelete = async (req, res) => {
  const { orgId, incomeId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const existing = await IncomeTransaction.findOne({ _id: incomeId, organization_id: orgId });
    if (!existing) {
      return res.status(404).json({ message: "Income not found", success: false });
    }

    await withTransaction(async (session) => {
      for (const a of existing.allocations) {
        await applyPartitionDelta(a.partition_id, -Number(a.amount), session);
      }
      await IncomeTransaction.deleteOne({ _id: incomeId }, { session });
    });

    return res.status(200).json({ message: "Income deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const expenseUpdate = async (req, res) => {
  const { orgId, expenseId } = req.params;
  const body = req.body;

  try {
    await getOrgForMember(orgId, req.user._id);
    const existing = await ExpenseTransaction.findOne({ _id: expenseId, organization_id: orgId });
    if (!existing) {
      return res.status(404).json({ message: "Expense not found", success: false });
    }

    const account_id = body.account_id || existing.account_id.toString();
    const partition_id = body.partition_id || existing.partition_id.toString();
    const amt = body.amount != null ? Number(body.amount) : existing.amount;
    if (!amt || amt <= 0) {
      return res.status(400).json({ message: "Valid amount is required", success: false });
    }

    const partition = await assertPartitionInAccount(partition_id, account_id, orgId);
    const personalFlag =
      typeof body.is_personal === "boolean" ? body.is_personal : existing.is_personal;
    assertExpensePartitionScope(partition, personalFlag);

    let categoryName = existing.category;
    if (body.category) {
      categoryName = await resolveCategoryName(orgId, "expense", body.category);
    }

    const expense = await withTransaction(async (session) => {
      await applyPartitionDelta(existing.partition_id, Number(existing.amount), session);
      await applyPartitionDelta(partition_id, -amt, session);

      if (body.amount != null) existing.amount = amt;
      existing.category = categoryName;
      if (body.account_id) existing.account_id = account_id;
      if (body.partition_id) existing.partition_id = partition_id;
      if (body.project_id !== undefined) {
        existing.project_id = await resolveProjectId(body.project_id, orgId);
      }
      if (body.income_source_id !== undefined) {
        existing.income_source_id = await resolveIncomeSourceId(body.income_source_id, orgId);
      }
      if (body.expense_date) existing.expense_date = new Date(body.expense_date);
      if (typeof body.is_personal === "boolean") existing.is_personal = body.is_personal;
      if (typeof body.recurring === "boolean") existing.recurring = body.recurring;
      if (typeof body.notes === "string") existing.notes = body.notes.trim();
      await existing.save({ session });
      return existing;
    });

    return res.status(200).json({ message: "Expense updated", success: true, expense });
  } catch (error) {
    return handleError(res, error);
  }
};

export const expenseDelete = async (req, res) => {
  const { orgId, expenseId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const existing = await ExpenseTransaction.findOne({ _id: expenseId, organization_id: orgId });
    if (!existing) {
      return res.status(404).json({ message: "Expense not found", success: false });
    }

    await withTransaction(async (session) => {
      await applyPartitionDelta(existing.partition_id, Number(existing.amount), session);
      await ExpenseTransaction.deleteOne({ _id: expenseId }, { session });
    });

    return res.status(200).json({ message: "Expense deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const partitionTransferCreate = async (req, res) => {
  const { orgId } = req.params;
  const { account_id, from_partition_id, to_partition_id, amount, transfer_date, notes } = req.body;

  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ message: "Valid amount is required", success: false });
  }
  if (!account_id || !from_partition_id || !to_partition_id) {
    return res.status(400).json({ message: "Account and both partitions are required", success: false });
  }
  if (from_partition_id === to_partition_id) {
    return res.status(400).json({ message: "Cannot transfer to the same partition", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    await assertPartitionInAccount(from_partition_id, account_id, orgId);
    await assertPartitionInAccount(to_partition_id, account_id, orgId);

    const transfer = await withTransaction(async (session) => {
      await applyPartitionDelta(from_partition_id, -amt, session);
      await applyPartitionDelta(to_partition_id, amt, session);

      const doc = new PartitionTransfer({
        organization_id: orgId,
        account_id,
        from_partition_id,
        to_partition_id,
        amount: amt,
        transfer_date: transfer_date ? new Date(transfer_date) : new Date(),
        notes: (notes || "").trim(),
      });
      await doc.save({ session });
      return doc;
    });

    return res.status(201).json({ message: "Transfer completed", success: true, transfer });
  } catch (error) {
    return handleError(res, error);
  }
};

export const transactionList = async (req, res) => {
  const { orgId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  try {
    await getOrgForMember(orgId, req.user._id);
    const [incomes, expenses, transfers] = await Promise.all([
      IncomeTransaction.find({ organization_id: orgId })
        .sort({ payment_date: -1 })
        .limit(limit)
        .populate("project_id", "name")
        .populate("client_id", "name")
        .populate("income_source_id", "name status"),
      ExpenseTransaction.find({ organization_id: orgId })
        .sort({ expense_date: -1 })
        .limit(limit)
        .populate("project_id", "name")
        .populate("income_source_id", "name status"),
      PartitionTransfer.find({ organization_id: orgId }).sort({ transfer_date: -1 }).limit(limit),
    ]);

    const partitionIds = new Set();
    for (const t of transfers) {
      partitionIds.add(t.from_partition_id?.toString());
      partitionIds.add(t.to_partition_id?.toString());
    }
    const partitionDocs = await Partition.find({ _id: { $in: [...partitionIds] } }).select("name");
    const partitionNames = Object.fromEntries(partitionDocs.map((p) => [p._id.toString(), p.name]));

    const transfersEnriched = transfers.map((t) => {
      const obj = t.toObject();
      obj.from_partition_name = partitionNames[t.from_partition_id?.toString()] || "";
      obj.to_partition_name = partitionNames[t.to_partition_id?.toString()] || "";
      return obj;
    });

    return res.status(200).json({
      message: "Transactions retrieved",
      success: true,
      incomes,
      expenses,
      transfers: transfersEnriched,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const categoryList = async (req, res) => {
  const { orgId } = req.params;
  const { type } = req.query;

  try {
    await getOrgForMember(orgId, req.user._id);
    await ensureDefaultCategories(orgId);

    const filter = { organization_id: orgId };
    if (type === "income" || type === "expense" || type === "subscription") filter.type = type;

    const categories = await FinanceCategory.find(filter).sort({ type: 1, name: 1 });
    return res.status(200).json({ message: "Categories retrieved", success: true, categories });
  } catch (error) {
    return handleError(res, error);
  }
};

export const categoryCreate = async (req, res) => {
  const { orgId } = req.params;
  const { name, type } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Category name is required", success: false });
  }
  if (type !== "income" && type !== "expense" && type !== "subscription") {
    return res.status(400).json({ message: "Type must be income, expense, or subscription", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const category = new FinanceCategory({
      organization_id: orgId,
      name: name.trim(),
      type,
      is_default: false,
    });
    await category.save();
    return res.status(201).json({ message: "Category created", success: true, category });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "This category already exists", success: false });
    }
    return handleError(res, error);
  }
};

export const categoryUpdate = async (req, res) => {
  const { orgId, categoryId } = req.params;
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: "Category name is required", success: false });
  }

  try {
    await getOrgForMember(orgId, req.user._id);
    const category = await FinanceCategory.findOne({ _id: categoryId, organization_id: orgId });
    if (!category) {
      return res.status(404).json({ message: "Category not found", success: false });
    }

    const oldName = category.name;
    const newName = name.trim();
    category.name = newName;
    await category.save();

    if (oldName !== newName) {
      if (category.type === "income") {
        await IncomeTransaction.updateMany(
          { organization_id: orgId, category: oldName },
          { $set: { category: newName } }
        );
      } else if (category.type === "subscription") {
        await Subscription.updateMany(
          { organization_id: orgId, category: oldName },
          { $set: { category: newName } }
        );
      } else {
        await ExpenseTransaction.updateMany(
          { organization_id: orgId, category: oldName },
          { $set: { category: newName } }
        );
      }
    }

    return res.status(200).json({ message: "Category updated", success: true, category });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "This category name already exists", success: false });
    }
    return handleError(res, error);
  }
};

export const categoryDelete = async (req, res) => {
  const { orgId, categoryId } = req.params;

  try {
    await getOrgForMember(orgId, req.user._id);
    const category = await FinanceCategory.findOne({ _id: categoryId, organization_id: orgId });
    if (!category) {
      return res.status(404).json({ message: "Category not found", success: false });
    }

    let inUse = false;
    if (category.type === "income") {
      inUse = await IncomeTransaction.exists({ organization_id: orgId, category: category.name });
    } else if (category.type === "subscription") {
      inUse = await Subscription.exists({ organization_id: orgId, category: category.name });
    } else {
      inUse = await ExpenseTransaction.exists({ organization_id: orgId, category: category.name });
    }

    if (inUse) {
      return res.status(400).json({
        message: "Category is in use. Reassign entries before deleting.",
        success: false,
      });
    }

    await FinanceCategory.findByIdAndDelete(categoryId);
    return res.status(200).json({ message: "Category deleted", success: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectProfitSummary = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const projects = await Project.find({ organization_id: orgId, isArchived: false });

    const partitions = await getPartitionsByOrg(orgId);
    const scopeMap = buildPartitionScopeMap(partitions);
    const businessIds = new Set(
      partitions.filter((p) => scopeMap[p._id.toString()] === "business").map((p) => p._id.toString())
    );

    const [incomes, expenses, unlinkedIncomes] = await Promise.all([
      IncomeTransaction.find({ organization_id: orgId, project_id: { $ne: null } }).select(
        "project_id amount allocations"
      ),
      ExpenseTransaction.find({ organization_id: orgId, project_id: { $ne: null } }).select(
        "project_id amount partition_id"
      ),
      IncomeTransaction.find({
        organization_id: orgId,
        $or: [{ project_id: null }, { project_id: { $exists: false } }],
      }).select("amount allocations"),
    ]);

    const businessIncomes = incomes
      .map((i) => ({
        project_id: i.project_id,
        amount: sumIncomeAllocationsForScopes(i, scopeMap, ["business"]),
      }))
      .filter((i) => i.amount > 0);

    const businessExpenses = expenses.filter((e) =>
      businessIds.has(e.partition_id?.toString())
    );

    const revenueMap = sumByProjectId(businessIncomes);
    const costMap = sumByProjectId(businessExpenses);
    const unlinkedIncomeTotal = unlinkedIncomes.reduce(
      (s, i) => s + sumIncomeAllocationsForScopes(i, scopeMap, ["business"]),
      0
    );

    const summary = projects.map((p) => {
      const revenue = revenueMap[p._id.toString()] || 0;
      const cost = costMap[p._id.toString()] || 0;
      return {
        project: p,
        revenue,
        cost,
        profit: revenue - cost,
      };
    });

    return res.status(200).json({
      message: "Project profit summary",
      success: true,
      summary,
      unlinkedIncomeTotal,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
