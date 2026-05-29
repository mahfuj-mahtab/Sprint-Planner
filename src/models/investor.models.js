import mongoose from "mongoose";

const investorSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    investor_type: {
      type: String,
      enum: ["individual", "company", "fund"],
      default: "individual",
    },
    // Ownership percentage (0-100, manually set by org owner/admin)
    ownership_percentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    // Total amount invested (automatically calculated)
    total_invested: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Number of separate investments
    investment_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "exited"],
      default: "active",
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

// Ensure organization_id + name is unique
investorSchema.index({ organization_id: 1, name: 1 }, { unique: true });

const Investor = mongoose.model("Investor", investorSchema);
export default Investor;
