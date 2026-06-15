import mongoose from "mongoose";
import { CONTENT_PRIORITIES, CONTENT_FORMATS } from "../constants/cmsWorkflow.js";

const checklistItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

const contentItemSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    status_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentPlatformStatus",
      required: true,
      index: true,
    },
    pillar_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentPillar",
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    /** Opening hook / first line. */
    hook: { type: String, trim: true, default: "" },
    /** Full script or long-form body. */
    script_body: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    content_format: {
      type: String,
      enum: CONTENT_FORMATS,
      default: "post",
    },
    priority: {
      type: String,
      enum: CONTENT_PRIORITIES,
      default: "medium",
    },
    tags: [{ type: String, trim: true }],
    hashtags: [{ type: String, trim: true }],
    cta: { type: String, trim: true, default: "" },
    series_name: { type: String, trim: true, default: "" },
    media_url: { type: String, trim: true, default: "" },
    published_url: { type: String, trim: true, default: "" },
    /** Repurposed from another content item. */
    repurpose_of: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      default: null,
      index: true,
    },
    checklist: [checklistItemSchema],
    scheduled_at: { type: Date, default: null },
    published_at: { type: Date, default: null },
    sort_order: { type: Number, default: 0 },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

contentItemSchema.index({ organization_id: 1, platform_id: 1, status_id: 1, sort_order: 1 });
contentItemSchema.index({ organization_id: 1, scheduled_at: 1 });

const ContentItem = mongoose.model("ContentItem", contentItemSchema);
export default ContentItem;
