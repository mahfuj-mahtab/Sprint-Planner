import mongoose from "mongoose";
import { REVIEW_TYPES, CHECKLIST_CATEGORIES } from "../constants/strategy.js";

const checklistItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: CHECKLIST_CATEGORIES,
      default: "growth",
    },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

const strategyReviewSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    review_type: {
      type: String,
      enum: REVIEW_TYPES,
      required: true,
    },
    year: { type: Number, required: true },
    period: { type: Number, default: null },
    period_label: { type: String, trim: true, default: "" },
    period_start: { type: Date, default: null },
    period_end: { type: Date, default: null },
    achievements: { type: String, trim: true, default: "" },
    failed: { type: String, trim: true, default: "" },
    why_failed: { type: String, trim: true, default: "" },
    stop_doing: { type: String, trim: true, default: "" },
    continue_doing: { type: String, trim: true, default: "" },
    start_doing: { type: String, trim: true, default: "" },
    okr_score_percent: { type: Number, min: 0, max: 100, default: null },
    notes: { type: String, trim: true, default: "" },
    checklist: [checklistItemSchema],
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

strategyReviewSchema.index(
  { organization_id: 1, review_type: 1, year: 1, period: 1 },
  { unique: true }
);

const StrategyReview = mongoose.model("StrategyReview", strategyReviewSchema);

export default StrategyReview;
