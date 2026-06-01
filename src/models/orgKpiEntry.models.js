import mongoose from "mongoose";

const orgKpiEntrySchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    kpi_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrgKpi",
      required: true,
      index: true,
    },
    value: { type: Number, required: true },
    recorded_at: { type: Date, required: true, default: Date.now },
    note: { type: String, trim: true, default: "" },
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

orgKpiEntrySchema.index({ kpi_id: 1, recorded_at: -1 });

const OrgKpiEntry = mongoose.model("OrgKpiEntry", orgKpiEntrySchema);

export default OrgKpiEntry;
