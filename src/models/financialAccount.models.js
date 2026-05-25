import mongoose from "mongoose";

const financialAccountSchema = new mongoose.Schema(
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
      enum: ["bank", "mobile", "cash", "online_wallet"],
      default: "bank",
    },
    currency: { type: String, trim: true, default: "BDT" },
  },
  { timestamps: true }
);

financialAccountSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const FinancialAccount = mongoose.model("FinancialAccount", financialAccountSchema);
export default FinancialAccount;
