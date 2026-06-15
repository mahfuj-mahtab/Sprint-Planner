import mongoose from "mongoose";

const projectDocRevisionSchema = new mongoose.Schema(
  {
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
    page_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectDocPage",
      required: true,
      index: true,
    },
    revision_number: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    change_summary: { type: String, trim: true, default: "" },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

projectDocRevisionSchema.index(
  { organization_id: 1, page_id: 1, revision_number: 1 },
  { unique: true }
);

const ProjectDocRevision = mongoose.model("ProjectDocRevision", projectDocRevisionSchema);
export default ProjectDocRevision;
