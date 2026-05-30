import mongoose from "mongoose";

const expenseTransactionSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialAccount",
      required: true,
      index: true,
    },
    partition_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partition",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      trim: true,
      default: "Misc",
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    income_source_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncomeSource",
      default: null,
      index: true,
    },
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
      index: true,
    },
    expense_date: { type: Date, required: true },
    is_personal: { type: Boolean, default: false },
    recurring: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const ExpenseTransaction = mongoose.model("ExpenseTransaction", expenseTransactionSchema);
export default ExpenseTransaction;
