import mongoose from "mongoose";
import { GOAL_PRIORITIES, GOAL_SETTLEMENT_STATUSES, GOAL_TYPES } from "../constants/goal.js";

const allocationSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialAccount", required: true },
    partition_id: { type: mongoose.Schema.Types.ObjectId, ref: "Partition", required: true },
    account_name: { type: String, trim: true, default: "" },
    partition_name: { type: String, trim: true, default: "" },
    currency: { type: String, trim: true, default: "BDT" },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const settlementSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: GOAL_SETTLEMENT_STATUSES, default: "bought" },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const financeGoalSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    target: { type: Number, required: true, min: 0 },
    type: { type: String, enum: GOAL_TYPES, default: "company" },
    priority: { type: String, enum: GOAL_PRIORITIES, default: "medium", index: true },
    currency: { type: String, trim: true, default: "BDT" },
    expected_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    allocations: { type: [allocationSchema], default: [] },
    settlements: { type: [settlementSchema], default: [] },
  },
  { timestamps: true }
);

financeGoalSchema.index({ organization_id: 1, priority: 1, expected_at: 1 });

const FinanceGoal = mongoose.model("FinanceGoal", financeGoalSchema);
export default FinanceGoal;
