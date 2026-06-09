import mongoose from "mongoose";

const contentPlatformSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "#a78bfa" },
    sort_order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

contentPlatformSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const ContentPlatform = mongoose.model("ContentPlatform", contentPlatformSchema);
export default ContentPlatform;
