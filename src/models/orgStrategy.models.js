import mongoose from "mongoose";

const orgStrategySchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
      index: true,
    },
    vision_10y: { type: String, trim: true, default: "" },
    mission: { type: String, trim: true, default: "" },
    core_values: [{ type: String, trim: true }],
    bhag_title: { type: String, trim: true, default: "" },
    bhag_description: { type: String, trim: true, default: "" },
    bhag_target: { type: String, trim: true, default: "" },
    bhag_target_year: { type: Number, default: null },
    long_term_completed: { type: Boolean, default: false },
    weekly_checklist_template: [
      {
        label: { type: String, required: true, trim: true },
        category: { type: String, default: "growth" },
      },
    ],
  },
  { timestamps: true }
);

const OrgStrategy = mongoose.model("OrgStrategy", orgStrategySchema);

export default OrgStrategy;
