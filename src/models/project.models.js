import mongoose from "mongoose";
import {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  LEGACY_PROJECT_STATUS_MAP,
} from "../constants/projectWorkflow.js";

const ALL_PROJECT_STATUSES = [...PROJECT_STATUSES, ...Object.keys(LEGACY_PROJECT_STATUS_MAP).filter(
  (s) => !PROJECT_STATUSES.includes(s)
)];

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
      enum: ALL_PROJECT_STATUSES,
      default: "pending",
    },
    priority: {
      type: String,
      enum: PROJECT_PRIORITIES,
      default: "medium",
      index: true,
    },
    start_date: {
      type: Date,
      default: null,
    },
    end_date: {
      type: Date,
      default: null,
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
    members: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["owner", "member"],
          default: "member",
        },
        status: {
          type: String,
          enum: ["active", "invited"],
          default: "active",
        },
      },
    ],
  },
  { timestamps: true }
);

projectSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const Project = mongoose.model("Project", projectSchema);

export default Project;
