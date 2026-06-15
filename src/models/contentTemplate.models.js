import mongoose from "mongoose";

const contentTemplateSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    /** Default title structure. Supports {{placeholder}} syntax. */
    title_template: { type: String, trim: true, default: "" },
    /** Default description / caption body. */
    body_template: { type: String, trim: true, default: "" },
    /** Default hashtags list. */
    default_tags: [{ type: String, trim: true }],
    /** Default priority. */
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

contentTemplateSchema.index(
  { organization_id: 1, name: 1 },
  { unique: true }
);

const ContentTemplate = mongoose.model("ContentTemplate", contentTemplateSchema);
export default ContentTemplate;
