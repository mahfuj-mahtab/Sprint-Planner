import mongoose from "mongoose";

const projectVersionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
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
    feature_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Feature",
      },
    ],
  },
  { timestamps: true }
);

projectVersionSchema.index({ organization_id: 1, project_id: 1, name: 1 }, { unique: true });

const ProjectVersion = mongoose.model("ProjectVersion", projectVersionSchema);

export default ProjectVersion;

