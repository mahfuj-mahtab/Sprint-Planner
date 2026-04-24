import mongoose from "mongoose";

const featureModuleSchema = new mongoose.Schema(
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
  },
  { timestamps: true }
);

featureModuleSchema.index({ organization_id: 1, project_id: 1, name: 1 }, { unique: true });

const FeatureModule = mongoose.model("FeatureModule", featureModuleSchema);

export default FeatureModule;

