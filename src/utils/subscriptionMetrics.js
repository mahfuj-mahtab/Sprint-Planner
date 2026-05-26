import ExpenseTransaction from "../models/expenseTransaction.models.js";
import Subscription from "../models/subscription.models.js";
import {
  monthlyEquivalent,
  yearlyEquivalent,
  chargesInMonth,
  buildMonthKeys,
  monthKey,
  startOfDay,
} from "./subscriptionSchedule.js";

const currencyForSub = (sub) => sub.account_id?.currency || "BDT";

const addToBucket = (map, currency, field, value) => {
  if (!map[currency]) {
    map[currency] = {
      runningMonthly: 0,
      plannedMonthly: 0,
      runningYearly: 0,
      plannedYearly: 0,
      actualThisMonth: 0,
      actualThisYear: 0,
      expectedThisMonth: 0,
    };
  }
  map[currency][field] += value;
};

export const buildSubscriptionDashboard = async (orgId) => {
  const [subscriptions, actualExpenses] = await Promise.all([
    Subscription.find({ organization_id: orgId })
      .populate("account_id", "name type currency")
      .populate("partition_id", "name")
      .populate("project_id", "name")
      .lean(),
    ExpenseTransaction.find({
      organization_id: orgId,
      recurring: true,
    })
      .select("amount expense_date category notes")
      .lean(),
  ]);

  const now = new Date();
  const thisMonthKey = monthKey(now);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthRows = buildMonthKeys(12, now);

  const actualByMonth = {};

  for (const exp of actualExpenses) {
    const k = monthKey(exp.expense_date);
    const amt = Number(exp.amount) || 0;
    actualByMonth[k] = (actualByMonth[k] || 0) + amt;
  }

  const summaryByCurrency = {};
  const byMonthByCurrency = {};
  const byCategory = {};
  const items = [];

  for (const sub of subscriptions) {
    const cur = currencyForSub(sub);
    const monthly = monthlyEquivalent(sub.amount, sub.billing_interval, sub.custom_interval_days);
    const yearly = yearlyEquivalent(sub.amount, sub.billing_interval, sub.custom_interval_days);
    const isRunning = sub.lifecycle === "running" || !sub.lifecycle;
    const isPlanned = sub.lifecycle === "planned";

    if (sub.is_active) {
      if (isRunning) {
        addToBucket(summaryByCurrency, cur, "runningMonthly", monthly);
        addToBucket(summaryByCurrency, cur, "runningYearly", yearly);
      }
      if (isPlanned) {
        addToBucket(summaryByCurrency, cur, "plannedMonthly", monthly);
        addToBucket(summaryByCurrency, cur, "plannedYearly", yearly);
      }
    }

    let expectedYtd = 0;
    for (const row of monthRows) {
      const charges = chargesInMonth(sub, row.year, row.month);
      const expected = charges.reduce((s, c) => s + c.amount, 0);
      if (!byMonthByCurrency[cur]) byMonthByCurrency[cur] = {};
      if (!byMonthByCurrency[cur][row.key]) {
        byMonthByCurrency[cur][row.key] = {
          expectedRunning: 0,
          expectedPlanned: 0,
          actual: 0,
        };
      }
      if (isRunning) byMonthByCurrency[cur][row.key].expectedRunning += expected;
      if (isPlanned) byMonthByCurrency[cur][row.key].expectedPlanned += expected;
      if (row.key === thisMonthKey) {
        addToBucket(summaryByCurrency, cur, "expectedThisMonth", expected);
      }
      if (row.year === now.getFullYear()) expectedYtd += expected;
    }

    const cat = sub.category || "Other";
    if (!byCategory[cat]) byCategory[cat] = { running: 0, planned: 0, count: 0 };
    byCategory[cat].count += 1;
    if (isRunning && sub.is_active) byCategory[cat].running += monthly;
    if (isPlanned && sub.is_active) byCategory[cat].planned += monthly;

    items.push({
      _id: sub._id,
      name: sub.name,
      lifecycle: sub.lifecycle || "running",
      is_active: sub.is_active,
      amount: sub.amount,
      billing_interval: sub.billing_interval,
      monthlyEquivalent: monthly,
      next_due_date: sub.next_due_date,
      planned_start_date: sub.planned_start_date,
      currency: cur,
      expectedYtd,
    });
  }

  for (const cur of Object.keys(summaryByCurrency)) {
    const s = summaryByCurrency[cur];
    s.totalMonthly = s.runningMonthly + s.plannedMonthly;
    s.totalYearly = s.runningYearly + s.plannedYearly;
    s.actualThisMonth = actualByMonth[thisMonthKey] || 0;
    s.actualThisYear = Object.entries(actualByMonth)
      .filter(([k]) => k.startsWith(String(now.getFullYear())))
      .reduce((sum, [, v]) => sum + v, 0);
    s.varianceThisMonth = s.actualThisMonth - s.expectedThisMonth;
  }

  const primaryCurrency =
    Object.entries(summaryByCurrency).sort(
      (a, b) => b[1].totalMonthly - a[1].totalMonthly
    )[0]?.[0] || "BDT";

  const byMonth = monthRows.map((row) => {
    const buckets = {};
    for (const [cur, months] of Object.entries(byMonthByCurrency)) {
      const m = months[row.key] || { expectedRunning: 0, expectedPlanned: 0 };
      buckets[cur] = {
        expectedRunning: m.expectedRunning,
        expectedPlanned: m.expectedPlanned,
        expectedTotal: m.expectedRunning + m.expectedPlanned,
        actual: actualByMonth[row.key] || 0,
      };
      buckets[cur].variance = buckets[cur].actual - buckets[cur].expectedTotal;
    }
    const primary = buckets[primaryCurrency] || {
      expectedRunning: 0,
      expectedPlanned: 0,
      expectedTotal: 0,
      actual: actualByMonth[row.key] || 0,
      variance: 0,
    };
    return {
      key: row.key,
      label: row.label,
      ...primary,
      byCurrency: buckets,
    };
  });

  const categoryRows = Object.entries(byCategory)
    .map(([name, v]) => ({ name, ...v, total: v.running + v.planned }))
    .sort((a, b) => b.total - a.total);

  const runningCount = subscriptions.filter(
    (s) => s.is_active && (s.lifecycle === "running" || !s.lifecycle)
  ).length;
  const plannedCount = subscriptions.filter((s) => s.is_active && s.lifecycle === "planned").length;

  return {
    primaryCurrency,
    summaryByCurrency,
    summary: summaryByCurrency[primaryCurrency] || {
      runningMonthly: 0,
      plannedMonthly: 0,
      totalMonthly: 0,
      runningYearly: 0,
      plannedYearly: 0,
      totalYearly: 0,
      actualThisMonth: 0,
      actualThisYear: 0,
      expectedThisMonth: 0,
      varianceThisMonth: 0,
    },
    byMonth,
    byCategory: categoryRows,
    items,
    counts: {
      total: subscriptions.length,
      running: runningCount,
      planned: plannedCount,
      active: subscriptions.filter((s) => s.is_active).length,
    },
  };
};
