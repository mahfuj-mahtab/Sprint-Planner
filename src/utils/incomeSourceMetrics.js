import IncomeTransaction from "../models/incomeTransaction.models.js";
import ExpenseTransaction from "../models/expenseTransaction.models.js";

export const normalizeForecastPeriods = (periods) => {
  if (!Array.isArray(periods)) return [];
  return periods
    .map((p, idx) => {
      const period_index = Math.max(1, Number(p.period_index) || idx + 1);
      const monthlyRaw = p.monthly_income;
      const monthly =
        monthlyRaw != null && monthlyRaw !== "" ? Math.max(0, Number(monthlyRaw)) : null;
      let yearly =
        p.yearly_income != null && p.yearly_income !== ""
          ? Math.max(0, Number(p.yearly_income))
          : null;
      if (monthly != null && monthly > 0) {
        yearly = monthly * 12;
      }
      return {
        period_index,
        monthly_income: monthly,
        yearly_income: yearly,
      };
    })
    .sort((a, b) => a.period_index - b.period_index);
};

export const EXPECTED_EARNING_PERIODS = ["monthly", "yearly"];

/** Normalize optional expected earning to monthly + yearly amounts */
export const resolveExpectedEarning = (sourceDoc) => {
  const amt = Number(sourceDoc.expected_earning_amount);
  if (amt > 0) {
    const period =
      sourceDoc.expected_earning_period === "yearly" ? "yearly" : "monthly";
    const monthly = period === "yearly" ? amt / 12 : amt;
    return {
      monthly,
      yearly: monthly * 12,
      basis: "simple",
      input_period: period,
      input_amount: amt,
    };
  }

  const timeline = buildRevenueTimeline(sourceDoc);
  const now = new Date();
  if (now < timeline.revenue_starts_at || !timeline.periods.length) {
    return null;
  }

  let active =
    timeline.periods.find((p) => now >= p.period_start && now <= p.period_end) || null;
  if (!active) {
    active = timeline.periods[timeline.periods.length - 1];
  }

  const monthly =
    active.monthly_income != null && active.monthly_income > 0
      ? active.monthly_income
      : active.yearly_total / 12;

  return {
    monthly,
    yearly: active.yearly_total,
    basis: "forecast",
    input_period: null,
    input_amount: null,
  };
};

/** Only the optional expected_earning_amount field (not forecast rows). */
export const resolveExplicitExpectedEarning = (sourceDoc) => {
  const amt = Number(sourceDoc.expected_earning_amount);
  if (!amt || amt <= 0) return null;
  const period = sourceDoc.expected_earning_period === "yearly" ? "yearly" : "monthly";
  const monthly = period === "yearly" ? amt / 12 : amt;
  return {
    monthly,
    yearly: monthly * 12,
    basis: "simple",
    input_period: period,
    input_amount: amt,
  };
};

/** Sum expected earnings across every income source (grouped by currency). */
export const aggregateExpectedEarnings = (sources) => {
  const byCurrency = {};
  let includedSourceCount = 0;

  for (const s of sources) {
    const resolved = resolveExplicitExpectedEarning(s);
    if (!resolved || resolved.monthly <= 0) continue;

    includedSourceCount += 1;
    const cur = (s.currency || "BDT").trim().toUpperCase();
    if (!byCurrency[cur]) {
      byCurrency[cur] = { monthly: 0, yearly: 0, sourceCount: 0 };
    }
    byCurrency[cur].monthly += resolved.monthly;
    byCurrency[cur].yearly += resolved.yearly;
    byCurrency[cur].sourceCount += 1;
  }

  const buckets = Object.entries(byCurrency)
    .map(([currency, v]) => ({
      currency,
      monthlyTotal: v.monthly,
      yearlyTotal: v.yearly,
      sourceCount: v.sourceCount,
    }))
    .sort((a, b) => b.yearlyTotal - a.yearlyTotal);

  const monthlyGrand = buckets.reduce((s, b) => s + b.monthlyTotal, 0);
  const yearlyGrand = buckets.reduce((s, b) => s + b.yearlyTotal, 0);

  return {
    totalSourceCount: sources.length,
    includedSourceCount,
    missingCount: sources.length - includedSourceCount,
    buckets,
    /** @deprecated use buckets — kept when exactly one currency */
    currency: buckets.length === 1 ? buckets[0].currency : null,
    monthlyTotal: buckets.length === 1 ? buckets[0].monthlyTotal : monthlyGrand,
    yearlyTotal: buckets.length === 1 ? buckets[0].yearlyTotal : yearlyGrand,
    sourceCount: includedSourceCount,
  };
};

export const forecastYearlyTotal = (period) => {
  if (!period) return 0;
  if (period.monthly_income != null && period.monthly_income > 0) {
    return period.monthly_income * 12;
  }
  return Number(period.yearly_income) || 0;
};

export const buildRevenueTimeline = (source) => {
  const start = source.started_at ? new Date(source.started_at) : new Date(source.createdAt);
  const offsetMonths = Number(source.revenue_start_after_months) || 0;
  const revenueStart = new Date(start);
  revenueStart.setMonth(revenueStart.getMonth() + offsetMonths);

  const periods = (source.forecast_periods || []).map((p) => {
    const periodStart = new Date(revenueStart);
    periodStart.setFullYear(periodStart.getFullYear() + (p.period_index - 1));
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    const yearlyTotal = forecastYearlyTotal(p);
    return {
      period_index: p.period_index,
      monthly_income: p.monthly_income,
      yearly_income: p.yearly_income,
      yearly_total: yearlyTotal,
      calendar_label: `${periodStart.getFullYear()}`,
      period_start: periodStart,
      period_end: periodEnd,
    };
  });

  const cumulativeForecast = periods.reduce((acc, row) => {
    const prev = acc.length ? acc[acc.length - 1].cumulative : 0;
    acc.push({
      period_index: row.period_index,
      cumulative: prev + row.yearly_total,
    });
    return acc;
  }, []);

  const totalForecastRevenue = periods.reduce((s, p) => s + p.yearly_total, 0);

  return {
    started_at: start,
    revenue_starts_at: revenueStart,
    periods,
    cumulative_forecast: cumulativeForecast,
    total_forecast_revenue: totalForecastRevenue,
  };
};

export const sumActualsForSource = async (sourceId, orgId, plannedInvestment = 0) => {
  const [incomes, expenses] = await Promise.all([
    IncomeTransaction.find({ organization_id: orgId, income_source_id: sourceId }),
    ExpenseTransaction.find({ organization_id: orgId, income_source_id: sourceId }),
  ]);

  const total_revenue = incomes.reduce((s, i) => s + Number(i.amount), 0);
  const total_invested = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const net = total_revenue - total_invested;
  const planned = Number(plannedInvestment) || 0;
  const investment_progress_pct = planned > 0 ? Math.min(100, (total_invested / planned) * 100) : null;
  const payback_progress_pct =
    planned > 0 ? Math.min(100, (total_revenue / planned) * 100) : null;

  return {
    total_revenue,
    total_invested,
    net,
    transaction_count: incomes.length + expenses.length,
    investment_progress_pct,
    payback_progress_pct,
    remaining_to_invest: Math.max(0, planned - total_invested),
    remaining_to_recover: Math.max(0, planned - total_revenue),
  };
};

export const enrichIncomeSource = async (source, orgId) => {
  const doc = source.toObject ? source.toObject() : { ...source };
  const timeline = buildRevenueTimeline(doc);
  const actuals = await sumActualsForSource(doc._id, orgId, doc.planned_investment);
  const planned = Number(doc.planned_investment) || 0;
  const expected_earning = resolveExpectedEarning(doc);

  return {
    ...doc,
    timeline,
    actuals,
    expected_earning,
    summary: {
      planned_investment: planned,
      total_forecast_revenue: timeline.total_forecast_revenue,
      forecast_vs_investment:
        planned > 0 ? timeline.total_forecast_revenue / planned : null,
      expected_monthly: expected_earning?.monthly ?? 0,
      expected_yearly: expected_earning?.yearly ?? 0,
      ...actuals,
    },
  };
};
