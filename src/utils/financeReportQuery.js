import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";
import IncomeSource from "../models/incomeSource.models.js";
import Project from "../models/project.models.js";
import { toObjectId } from "./mongoIds.js";
import {
  getPartitionsByOrg,
  buildPartitionScopeMap,
  sumIncomeAllocationsForScopes,
} from "./partitionFinance.js";
import { effectivePartitionScope } from "../constants/partitionScopes.js";

const parseYear = (value) => {
  const y = Number.parseInt(value, 10);
  if (!Number.isFinite(y) || y < 1970 || y > 9999) {
    return new Date().getFullYear();
  }
  return y;
};

const yearDateRange = (year) => ({
  start: new Date(year, 0, 1),
  end: new Date(year, 11, 31, 23, 59, 59, 999),
});

const emptyMonthly = () => Array.from({ length: 12 }, () => 0);

const addToMonthly = (monthly, date, amount) => {
  if (!date) return;
  const d = new Date(date);
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== monthly._year) return;
  const idx = d.getMonth();
  monthly[idx] += Number(amount) || 0;
};

const initMonthlyTracker = (year) => {
  const arr = emptyMonthly();
  arr._year = year;
  return arr;
};

const monthlyFromTracker = (tracker) => tracker.map((v) => v);

export const buildFinanceYearlyReport = async (orgId, query) => {
  const year = parseYear(query.year);
  const mode = query.mode === "all" ? "all" : "business";
  const { start, end } = yearDateRange(year);
  const orgOid = toObjectId(orgId);

  const partitions = await getPartitionsByOrg(orgId);
  const scopeMap = buildPartitionScopeMap(partitions);
  const businessPartitionIds = new Set(
    partitions
      .filter((p) => effectivePartitionScope(p) === "business")
      .map((p) => p._id.toString())
  );

  const [incomeDocs, expenseDocs, projects, sources] = await Promise.all([
    IncomeTransaction.find({
      organization_id: orgOid,
      payment_date: { $gte: start, $lte: end },
    }).select("amount allocations project_id income_source_id payment_date"),
    ExpenseTransaction.find({
      organization_id: orgOid,
      expense_date: { $gte: start, $lte: end },
    }).select("amount partition_id project_id income_source_id expense_date is_personal"),
    Project.find({ organization_id: orgId, isArchived: false }).select("name"),
    IncomeSource.find({ organization_id: orgId }).select("name status"),
  ]);

  const incomeMonthly = initMonthlyTracker(year);
  const expenseMonthly = initMonthlyTracker(year);

  const projectIncome = {};
  const projectExpense = {};
  const sourceIncome = {};
  const sourceExpense = {};
  let unlinkedProjectIncome = 0;
  let unlinkedSourceIncome = 0;

  for (const doc of incomeDocs) {
    let amount =
      mode === "all"
        ? Number(doc.amount) || 0
        : sumIncomeAllocationsForScopes(doc, scopeMap, ["business"]);
    if (amount <= 0) continue;

    addToMonthly(incomeMonthly, doc.payment_date, amount);

    const projectKey = doc.project_id?.toString();
    if (projectKey) {
      projectIncome[projectKey] = (projectIncome[projectKey] || 0) + amount;
    } else {
      unlinkedProjectIncome += amount;
    }

    const sourceKey = doc.income_source_id?.toString();
    if (sourceKey) {
      sourceIncome[sourceKey] = (sourceIncome[sourceKey] || 0) + amount;
    } else {
      unlinkedSourceIncome += amount;
    }
  }

  for (const doc of expenseDocs) {
    const partitionKey = doc.partition_id?.toString();
    const isBusinessPartition = businessPartitionIds.has(partitionKey);
    if (mode === "business" && !isBusinessPartition) continue;

    const amount = Number(doc.amount) || 0;
    if (amount <= 0) continue;

    addToMonthly(expenseMonthly, doc.expense_date, amount);

    const projectKey = doc.project_id?.toString();
    if (projectKey) {
      projectExpense[projectKey] = (projectExpense[projectKey] || 0) + amount;
    }

    const sourceKey = doc.income_source_id?.toString();
    if (sourceKey) {
      sourceExpense[sourceKey] = (sourceExpense[sourceKey] || 0) + amount;
    }
  }

  const incomeMonths = monthlyFromTracker(incomeMonthly);
  const expenseMonths = monthlyFromTracker(expenseMonthly);
  const netMonths = incomeMonths.map((inc, i) => inc - expenseMonths[i]);

  const yearlyIncome = incomeMonths.reduce((s, v) => s + v, 0);
  const yearlyExpense = expenseMonths.reduce((s, v) => s + v, 0);

  const projectMap = Object.fromEntries(projects.map((p) => [p._id.toString(), p.name]));
  const sourceMap = Object.fromEntries(sources.map((s) => [s._id.toString(), s]));

  const projectIds = new Set([...Object.keys(projectIncome), ...Object.keys(projectExpense)]);
  const byProject = [...projectIds].map((id) => {
    const income = projectIncome[id] || 0;
    const expense = projectExpense[id] || 0;
    return {
      projectId: id,
      name: projectMap[id] || "Unknown project",
      income,
      expense,
      profit: income - expense,
    };
  });
  byProject.sort((a, b) => b.income + b.expense - (a.income + a.expense));

  const sourceIds = new Set([...Object.keys(sourceIncome), ...Object.keys(sourceExpense)]);
  const byIncomeSource = [...sourceIds].map((id) => {
    const src = sourceMap[id];
    const income = sourceIncome[id] || 0;
    const expense = sourceExpense[id] || 0;
    return {
      sourceId: id,
      name: src?.name || "Unknown source",
      status: src?.status || "",
      income,
      expense,
      net: income - expense,
    };
  });
  byIncomeSource.sort((a, b) => b.income + b.expense - (a.income + a.expense));

  return {
    year,
    mode,
    summary: {
      monthly: {
        income: incomeMonths,
        expense: expenseMonths,
        net: netMonths,
      },
      yearly: {
        income: yearlyIncome,
        expense: yearlyExpense,
        net: yearlyIncome - yearlyExpense,
      },
    },
    byProject,
    byIncomeSource,
    unlinked: {
      projectIncome: unlinkedProjectIncome,
      sourceIncome: unlinkedSourceIncome,
    },
  };
};

/** Monthly income totals per income source (all amounts). Optional year narrows range. */
export const buildIncomeSourceMonthlyActuals = async (orgId, year) => {
  const orgOid = toObjectId(orgId);
  const filter = {
    organization_id: orgOid,
    income_source_id: { $ne: null },
  };

  if (year) {
    const { start, end } = yearDateRange(year);
    filter.payment_date = { $gte: start, $lte: end };
  }

  const docs = await IncomeTransaction.find(filter).select(
    "amount income_source_id payment_date"
  );

  const bySourceMonth = {};
  const yearsSet = new Set();
  for (const doc of docs) {
    const srcId = doc.income_source_id?.toString();
    if (!srcId) continue;
    const d = new Date(doc.payment_date);
    if (Number.isNaN(d.getTime())) continue;
    yearsSet.add(d.getFullYear());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!bySourceMonth[srcId]) bySourceMonth[srcId] = {};
    bySourceMonth[srcId][key] =
      (bySourceMonth[srcId][key] || 0) + Number(doc.amount || 0);
  }

  return {
    year: year || null,
    years: Array.from(yearsSet).sort((a, b) => a - b),
    bySourceMonth,
  };
};
