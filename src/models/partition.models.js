import mongoose from "mongoose";
import { DEFAULT_PARTITION_SCOPE, PARTITION_SCOPES } from "../constants/partitionScopes.js";

const partitionSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialAccount",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    balance: { type: Number, default: 0, min: 0 },
    is_default: { type: Boolean, default: false },
    scope: {
      type: String,
      enum: PARTITION_SCOPES,
      default: DEFAULT_PARTITION_SCOPE,
    },
  },
  { timestamps: true }
);

partitionSchema.index({ account_id: 1, name: 1 }, { unique: true });

const Partition = mongoose.model("Partition", partitionSchema);
export default Partition;
