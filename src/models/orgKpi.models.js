import mongoose from "mongoose";
import { KPI_CATEGORIES, KPI_FREQUENCIES } from "../constants/strategy.js";

const orgKpiSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      enum: KPI_CATEGORIES,
      default: "growth",
    },
    unit: { type: String, trim: true, default: "" },
    target_value: { type: Number, default: null },
    current_value: { type: Number, default: 0 },
    frequency: {
      type: String,
      enum: KPI_FREQUENCIES,
      default: "monthly",
    },
    pillar_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StrategicPillar",
      default: null,
    },
    is_higher_better: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

orgKpiSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const OrgKpi = mongoose.model("OrgKpi", orgKpiSchema);

export default OrgKpi;
