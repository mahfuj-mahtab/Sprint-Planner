import mongoose from "mongoose";

const learningAssignmentSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    topic_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningTopic",
      required: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed", "overdue"],
      default: "not_started",
    },
    progress_percent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    start_date: { type: Date, default: null },
    due_date: { type: Date, default: null },
    notes: { type: String, trim: true, default: "" },
    assigned_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    completed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

learningAssignmentSchema.index({ organization_id: 1, topic_id: 1, user_id: 1 }, { unique: true });

const LearningAssignment = mongoose.model("LearningAssignment", learningAssignmentSchema);
export default LearningAssignment;
