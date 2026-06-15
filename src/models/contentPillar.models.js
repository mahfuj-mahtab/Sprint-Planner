import mongoose from "mongoose";

const contentPillarSchema = new mongoose.Schema(
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
    description: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "#22d3ee" },
    /** Target share of total content (0-100). */
    target_share: { type: Number, default: 25, min: 0, max: 100 },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

contentPillarSchema.index(
  { organization_id: 1, platform_id: 1, name: 1 },
  { unique: true }
);

const ContentPillar = mongoose.model("ContentPillar", contentPillarSchema);
export default ContentPillar;
