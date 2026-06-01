import mongoose from "mongoose";
import { GOAL_LEVELS, GOAL_STATUSES } from "../constants/strategy.js";

const keyResultSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    target: { type: Number, default: null },
    current: { type: Number, default: 0 },
    unit: { type: String, trim: true, default: "" },
    completed: { type: Boolean, default: false },
  },
  { _id: true }
);

const orgStrategicGoalSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    level: {
      type: String,
      enum: GOAL_LEVELS,
      required: true,
      index: true,
    },
    parent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrgStrategicGoal",
      default: null,
      index: true,
    },
    pillar_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StrategicPillar",
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    year: { type: Number, default: null, index: true },
    quarter: { type: Number, min: 1, max: 4, default: null },
    month: { type: Number, min: 1, max: 12, default: null },
    target_value: { type: Number, default: null },
    current_value: { type: Number, default: 0 },
    unit: { type: String, trim: true, default: "" },
    progress_percent: { type: Number, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      enum: GOAL_STATUSES,
      default: "active",
    },
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    project_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
      },
    ],
    key_results: [keyResultSchema],
    sort_order: { type: Number, default: 0 },
    due_date: { type: Date, default: null },
  },
  { timestamps: true }
);

orgStrategicGoalSchema.index({ organization_id: 1, level: 1, year: 1, quarter: 1 });

const OrgStrategicGoal = mongoose.model("OrgStrategicGoal", orgStrategicGoalSchema);

export default OrgStrategicGoal;
