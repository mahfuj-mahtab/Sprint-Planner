import mongoose from "mongoose";

const financeCategorySchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["income", "expense", "subscription"],
      required: true,
    },
    is_default: { type: Boolean, default: false },
  },
  { timestamps: true }
);

financeCategorySchema.index({ organization_id: 1, type: 1, name: 1 }, { unique: true });

const FinanceCategory = mongoose.model("FinanceCategory", financeCategorySchema);
export default FinanceCategory;
