/** Strip money fields when role cannot see exact amounts (editor). */
export const redactDebtRecord = (debt, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !debt) return debt;
  return {
    ...debt,
    principal: null,
    outstanding: null,
    repaid: null,
    repayments: (debt.repayments || []).map((r) => ({ ...r, amount: null })),
  };
};

export const redactDebtListResponse = (payload, canSeeExactAmounts) => {
  if (canSeeExactAmounts) return payload;
  return {
    ...payload,
    debts: (payload.debts || []).map((d) => redactDebtRecord(d, false)),
    totalReceivable: null,
    totalPayable: null,
    totalOutstanding: null,
  };
};

export const redactOverviewAmounts = (overview, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !overview) return overview;
  const hide = (v) => (v == null ? v : null);
  const accounts = (overview.accounts || []).map((a) => ({
    ...a,
    totalBalance: null,
    partitions: (a.partitions || []).map((p) => ({ ...p, balance: null })),
  }));
  return {
    ...overview,
    monthIncome: hide(overview.monthIncome),
    monthExpense: hide(overview.monthExpense),
    netProfit: hide(overview.netProfit),
    businessMonthIncome: hide(overview.businessMonthIncome),
    businessMonthExpense: hide(overview.businessMonthExpense),
    businessNetProfit: hide(overview.businessNetProfit),
    businessYearIncome: hide(overview.businessYearIncome),
    businessYearExpense: hide(overview.businessYearExpense),
    businessYearProfit: hide(overview.businessYearProfit),
    businessAllTimeIncome: hide(overview.businessAllTimeIncome),
    businessAllTimeExpense: hide(overview.businessAllTimeExpense),
    businessAllTimeProfit: hide(overview.businessAllTimeProfit),
    businessBalance: hide(overview.businessBalance),
    ownerBalance: hide(overview.ownerBalance),
    excludedBalance: hide(overview.excludedBalance),
    totalBalance: hide(overview.totalBalance),
    debtOutstanding: hide(overview.debtOutstanding),
    debtReceivable: hide(overview.debtReceivable),
    debtPayable: hide(overview.debtPayable),
    accounts,
  };
};

export const redactInvestor = (investor, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !investor) return investor;
  return {
    ...investor,
    total_invested: null,
  };
};

export const redactInvestmentTransaction = (transaction, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !transaction) return transaction;
  const doc = transaction.toObject ? transaction.toObject() : transaction;
  return {
    ...doc,
    amount: null,
    allocations: (doc.allocations || []).map((a) => ({ ...a, amount: null })),
  };
};

export const redactInvestorDashboard = (data, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !data) return data;
  return {
    ...data,
    summary: {
      ...data.summary,
      total_raised: null,
      totals_by_currency: (data.summary?.totals_by_currency || []).map((row) => ({
        ...row,
        amount: null,
      })),
    },
    investors: (data.investors || []).map((inv) => ({
      ...inv,
      total_invested: null,
      transactions: (inv.transactions || []).map((tx) => ({ ...tx, amount: null })),
    })),
    ownershipSummary: (data.ownershipSummary || []).map((row) => ({
      ...row,
      total_invested: null,
    })),
  };
};

export const redactInvestorSummary = (data, canSeeExactAmounts) => {
  if (canSeeExactAmounts || !data) return data;
  return {
    ...data,
    totalRaised: null,
    avgInvestment: null,
    totalsByCurrency: (data.totalsByCurrency || []).map((row) => ({ ...row, amount: null })),
    topInvestors: (data.topInvestors || []).map((row) => ({ ...row, total_invested: null })),
  };
};
