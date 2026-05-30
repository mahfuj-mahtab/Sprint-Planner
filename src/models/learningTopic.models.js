import mongoose from "mongoose";

const learningTopicSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "active",
    },
    sort_order: { type: Number, default: 0 },
    start_date: { type: Date, default: null },
    due_date: { type: Date, default: null },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

learningTopicSchema.index({ organization_id: 1, sort_order: 1 });

const LearningTopic = mongoose.model("LearningTopic", learningTopicSchema);
export default LearningTopic;
