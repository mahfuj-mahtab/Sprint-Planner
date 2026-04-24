import mongoose from "mongoose";

const featureSchema = new mongoose.Schema(
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
      index: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    module_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FeatureModule",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

featureSchema.index({ organization_id: 1, project_id: 1, module_id: 1, name: 1 }, { unique: true });

const Feature = mongoose.model("Feature", featureSchema);

export default Feature;

