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
    /** Icon key — youtube, instagram, tiktok, x, linkedin, facebook, podcast, blog, threads, pinterest, other. */
    icon: { type: String, trim: true, default: "other" },
    /** Type of platform — used for analytics and cadence defaults. */
    platform_type: {
      type: String,
      enum: ["video", "short", "photo", "text", "audio", "mixed"],
      default: "mixed",
    },
    /** @handle on the platform, without the @. */
    account_handle: { type: String, trim: true, default: "" },
    /** Full URL to the account. */
    account_url: { type: String, trim: true, default: "" },
    /** Niche / category focus, e.g. "dev education". */
    niche: { type: String, trim: true, default: "" },
    /** Latest known follower / subscriber count. */
    current_followers: { type: Number, default: 0, min: 0 },
    /** Follower history snapshots [{ at, count }] for growth charts. */
    follower_history: [
      new mongoose.Schema(
        {
          at: { type: Date, default: Date.now },
          count: { type: Number, default: 0, min: 0 },
        },
        { _id: false }
      ),
    ],
    /** Default engagement rate target (e.g. 4 means 4%). */
    engagement_rate_target: { type: Number, default: 4, min: 0 },
    sort_order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

contentPlatformSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const ContentPlatform = mongoose.model("ContentPlatform", contentPlatformSchema);
export default ContentPlatform;
