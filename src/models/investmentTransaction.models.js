import mongoose from "mongoose";

const allocationSchema = new mongoose.Schema(
  {
    partition_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partition",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const investmentTransactionSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },
    // Link to income transaction for accounting purposes
    income_transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncomeTransaction",
      default: null,
      index: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialAccount",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    allocations: {
      type: [allocationSchema],
      default: [],
    },
    transaction_type: {
      type: String,
      enum: ["investment", "withdrawal", "dividend_payment"],
      default: "investment",
    },
    investment_date: {
      type: Date,
      required: true,
    },
    currency: {
      type: String,
      default: "BDT",
      trim: true,
    },
    payment_method: {
      type: String,
      enum: ["bkash", "bank", "cash", "stripe", "paypal", "other"],
      default: "other",
    },
    // Reference number from investor (e.g., check number, wire ref)
    reference_number: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

investmentTransactionSchema.index({ organization_id: 1, investor_id: 1, investment_date: -1 });

const InvestmentTransaction = mongoose.model("InvestmentTransaction", investmentTransactionSchema);
export default InvestmentTransaction;
