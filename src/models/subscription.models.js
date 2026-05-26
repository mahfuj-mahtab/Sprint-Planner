import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, default: "Subscription" },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialAccount",
      required: true,
    },
    partition_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partition",
      required: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    billing_interval: {
      type: String,
      enum: ["weekly", "monthly", "quarterly", "yearly", "custom"],
      default: "monthly",
    },
    custom_interval_days: { type: Number, min: 1, default: 30 },
    next_due_date: { type: Date, required: true },
    /** running = live recurring cost; planned = expected but not started yet */
    lifecycle: {
      type: String,
      enum: ["running", "planned"],
      default: "running",
    },
    planned_start_date: { type: Date, default: null },
    is_active: { type: Boolean, default: true },
    auto_deduct: { type: Boolean, default: true },
    last_charged_at: { type: Date, default: null },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

subscriptionSchema.index({ organization_id: 1, next_due_date: 1, is_active: 1 });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
export default Subscription;
