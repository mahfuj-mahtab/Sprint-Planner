import mongoose from "mongoose";

/**
 * Platform Status Schema
 */
const platformStatusSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    }
  },
  { timestamps: true }
);

export const PlatformStatus = mongoose.model(
  "PlatformStatus",
  platformStatusSchema
);

/**
 * Platform Schema
 */
const platformSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PlatformStatus",
      },
    ],
  },
  { timestamps: true }
);

const Platform = mongoose.model("Platform", platformSchema);

export default Platform;