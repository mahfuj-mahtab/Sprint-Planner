import mongoose from "mongoose";

const customMetricSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: Number, default: 0 },
  },
  { _id: false }
);

const contentAnalyticsSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    content_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      required: true,
      index: true,
    },
    platform_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentPlatform",
      required: true,
      index: true,
    },
    recorded_at: { type: Date, default: Date.now },
    views: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    watch_time_minutes: { type: Number, default: 0, min: 0 },
    subscribers_gained: { type: Number, default: 0, min: 0 },
    custom_metrics: [customMetricSchema],
    notes: { type: String, trim: true, default: "" },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

contentAnalyticsSchema.index({ organization_id: 1, content_id: 1, recorded_at: -1 });

const ContentAnalytics = mongoose.model("ContentAnalytics", contentAnalyticsSchema);
export default ContentAnalytics;
