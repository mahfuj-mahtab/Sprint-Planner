import mongoose from "mongoose";

const debtRepaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    repaid_at: { type: Date, required: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const debtRecordSchema = new mongoose.Schema(
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
    direction: {
      type: String,
      enum: ["lent", "borrowed"],
      default: "lent",
      index: true,
    },
    counterparty_name: { type: String, required: true, trim: true },
    principal: { type: Number, required: true, min: 0 },
    outstanding: { type: Number, required: true, min: 0 },
    lent_at: { type: Date, required: true },
    notes: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["open", "settled"],
      default: "open",
      index: true,
    },
    repayments: [debtRepaymentSchema],
  },
  { timestamps: true }
);

const DebtRecord = mongoose.model("DebtRecord", debtRecordSchema);
export default DebtRecord;
