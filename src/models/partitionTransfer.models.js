import mongoose from "mongoose";

const partitionTransferSchema = new mongoose.Schema(
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
    from_partition_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partition",
      required: true,
    },
    to_partition_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partition",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    transfer_date: { type: Date, required: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const PartitionTransfer = mongoose.model("PartitionTransfer", partitionTransferSchema);
export default PartitionTransfer;
