import mongoose from "mongoose";

const contentPlatformStatusSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true },
    color: { type: String, trim: true, default: "#94a3b8" },
    sort_order: { type: Number, default: 0 },
    /** Marks content in this column as scheduled (for dashboard filters). */
    is_scheduled_stage: { type: Boolean, default: false },
    /** Marks published/live content (for analytics rollups). */
    is_published_stage: { type: Boolean, default: false },
  },
  { timestamps: true }
);

contentPlatformStatusSchema.index(
  { organization_id: 1, platform_id: 1, name: 1 },
  { unique: true }
);

const ContentPlatformStatus = mongoose.model(
  "ContentPlatformStatus",
  contentPlatformStatusSchema
);
export default ContentPlatformStatus;
