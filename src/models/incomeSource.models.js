import mongoose from "mongoose";
import { INCOME_SOURCE_STATUSES, INCOME_SOURCE_TYPES } from "../constants/incomeSource.js";

const forecastPeriodSchema = new mongoose.Schema(
  {
    period_index: { type: Number, required: true, min: 1 },
    monthly_income: { type: Number, default: null, min: 0 },
    yearly_income: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const incomeSourceSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: INCOME_SOURCE_TYPES,
      default: "other",
    },
    status: {
      type: String,
      enum: INCOME_SOURCE_STATUSES,
      default: "idea",
      index: true,
    },
    currency: { type: String, trim: true, default: "BDT" },
    planned_investment: { type: Number, default: 0, min: 0 },
    revenue_start_after_months: { type: Number, default: 0, min: 0 },
    expected_earning_amount: { type: Number, default: null, min: 0 },
    expected_earning_period: {
      type: String,
      enum: ["monthly", "yearly"],
      default: "monthly",
    },
    forecast_periods: { type: [forecastPeriodSchema], default: [] },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    started_at: { type: Date, default: null },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

incomeSourceSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const IncomeSource = mongoose.model("IncomeSource", incomeSourceSchema);
export default IncomeSource;
