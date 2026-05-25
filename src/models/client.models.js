import mongoose from "mongoose";

const communicationLogSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true },
    loggedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const clientSchema = new mongoose.Schema(
  {
    organization_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    communicationLogs: [communicationLogSchema],
  },
  { timestamps: true }
);

clientSchema.index({ organization_id: 1, name: 1 });

const Client = mongoose.model("Client", clientSchema);
export default Client;
