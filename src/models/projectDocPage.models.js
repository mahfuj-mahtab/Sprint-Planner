import mongoose from "mongoose";

const DOC_TYPES = ["overview", "version", "feature", "guide", "custom"];

const projectDocPageSchema = new mongoose.Schema(
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
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    doc_type: {
      type: String,
      enum: DOC_TYPES,
      default: "custom",
      index: true,
    },
    version_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectVersion",
      default: null,
      index: true,
    },
    feature_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
      default: null,
      index: true,
    },
    /** TipTap / ProseMirror JSON document */
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    sort_order: { type: Number, default: 0 },
    revision_count: { type: Number, default: 0 },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

projectDocPageSchema.index(
  { organization_id: 1, project_id: 1, slug: 1 },
  { unique: true }
);
projectDocPageSchema.index(
  { organization_id: 1, project_id: 1, version_id: 1 },
  { unique: true, partialFilterExpression: { version_id: { $type: "objectId" } } }
);
projectDocPageSchema.index(
  { organization_id: 1, project_id: 1, feature_id: 1 },
  { unique: true, partialFilterExpression: { feature_id: { $type: "objectId" } } }
);

const ProjectDocPage = mongoose.model("ProjectDocPage", projectDocPageSchema);
export default ProjectDocPage;
