import Investor from "../models/investor.models.js";
import InvestmentTransaction from "../models/investmentTransaction.models.js";
import FinancialAccount from "../models/financialAccount.models.js";

export const assertInvestorInOrg = async (investorId, orgId) => {
  if (!investorId) return null;
  const investor = await Investor.findOne({ _id: investorId, organization_id: orgId });
  if (!investor) {
    const err = new Error("Investor not found");
    err.status = 404;
    throw err;
  }
  return investor;
};

export const createReturnForExpense = async ({ orgId, investorId, expense, userId, session }) => {
  const account = await FinancialAccount.findById(expense.account_id).session(session);
  const tx = new InvestmentTransaction({
    organization_id: orgId,
    investor_id: investorId,
    account_id: expense.account_id,
    amount: expense.amount,
    allocations: [{ partition_id: expense.partition_id, amount: expense.amount }],
    transaction_type: "dividend_payment",
    investment_date: expense.expense_date,
    expense_transaction_id: expense._id,
    currency: account?.currency || "BDT",
    notes: expense.notes || "",
    created_by: userId,
  });
  await tx.save({ session });
  return tx;
};

export const deleteReturnForExpense = async (expenseId, session) => {
  await InvestmentTransaction.deleteOne(
    { expense_transaction_id: expenseId, transaction_type: "dividend_payment" },
    { session }
  );
};

export const syncReturnForExpense = async ({ orgId, investorId, expense, userId, session }) => {
  await deleteReturnForExpense(expense._id, session);
  if (investorId) {
    await assertInvestorInOrg(investorId, orgId);
    return createReturnForExpense({ orgId, investorId, expense, userId, session });
  }
  return null;
};
