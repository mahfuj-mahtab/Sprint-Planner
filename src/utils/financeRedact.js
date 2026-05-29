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
