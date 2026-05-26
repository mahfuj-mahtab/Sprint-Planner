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

const incomeTransactionSchema = new mongoose.Schema(
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
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      trim: true,
      default: "Other income",
    },
    source: {
      type: String,
      enum: ["client", "product", "other"],
      default: "other",
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    income_source_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IncomeSource",
      default: null,
      index: true,
    },
    allocations: { type: [allocationSchema], required: true },
    payment_date: { type: Date, required: true },
    payment_method: {
      type: String,
      enum: ["bkash", "bank", "cash", "stripe", "paypal", "other"],
      default: "other",
    },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const IncomeTransaction = mongoose.model("IncomeTransaction", incomeTransactionSchema);
export default IncomeTransaction;
