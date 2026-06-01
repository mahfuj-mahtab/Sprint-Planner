import mongoose from "mongoose";

const strategicPillarSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "#00d4ff" },
    sort_order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

strategicPillarSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const StrategicPillar = mongoose.model("StrategicPillar", strategicPillarSchema);

export default StrategicPillar;
