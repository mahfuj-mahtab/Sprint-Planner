import mongoose from "mongoose";
import { CONTENT_PRIORITIES } from "../constants/cmsWorkflow.js";

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
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    priority: {
      type: String,
      enum: CONTENT_PRIORITIES,
      default: "medium",
    },
    tags: [{ type: String, trim: true }],
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
