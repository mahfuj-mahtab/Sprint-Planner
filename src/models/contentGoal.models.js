import mongoose from "mongoose";

/**
 * Growth goal for a platform (or org-wide if platform_id is null).
 * Tracks a target value (e.g. 10000 followers) by a target date.
 */
const contentGoalSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    platform_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentPlatform",
      default: null,
      index: true,
    },
    /** Metric being tracked. */
    metric: {
      type: String,
      enum: ["followers", "subscribers", "views", "posts_published", "engagement_rate"],
      default: "followers",
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    start_value: { type: Number, default: 0, min: 0 },
    target_value: { type: Number, required: true, min: 0 },
    target_date: { type: Date, default: null },
    achieved_at: { type: Date, default: null },
    is_archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const ContentGoal = mongoose.model("ContentGoal", contentGoalSchema);
export default ContentGoal;
