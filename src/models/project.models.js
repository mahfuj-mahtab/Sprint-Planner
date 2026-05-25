import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
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
    documentation: {
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
    client_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
      index: true,
    },
    project_type: {
      type: String,
      enum: ["product", "client_work", "internal"],
      default: "product",
    },
    status: {
      type: String,
      enum: ["active", "paused", "completed"],
      default: "active",
    },
    budget: {
      type: Number,
      default: null,
      min: 0,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

projectSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const Project = mongoose.model("Project", projectSchema);

export default Project;
