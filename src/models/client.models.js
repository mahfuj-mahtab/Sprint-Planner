import mongoose from "mongoose";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  CLIENT_PRIORITIES,
  LOG_TYPES,
} from "../constants/crmClient.js";

const communicationLogSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true },
    type: { type: String, enum: LOG_TYPES, default: "note" },
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
    website: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: CLIENT_STATUSES,
      default: "lead",
      index: true,
    },
    client_type: {
      type: String,
      enum: CLIENT_TYPES,
      default: "prospect",
    },
    priority: {
      type: String,
      enum: CLIENT_PRIORITIES,
      default: "normal",
    },
    currency: { type: String, trim: true, default: "BDT" },
    hourly_rate: { type: Number, default: null, min: 0 },
    expected_value: { type: Number, default: null, min: 0 },
    referral_source: { type: String, trim: true, default: "" },
    tags: { type: [String], default: [] },
    next_follow_up: { type: Date, default: null },
    last_contacted_at: { type: Date, default: null },
    communicationLogs: [communicationLogSchema],
  },
  { timestamps: true }
);

clientSchema.index({ organization_id: 1, name: 1 });
clientSchema.index({ organization_id: 1, status: 1 });
clientSchema.index({ organization_id: 1, next_follow_up: 1 });

const Client = mongoose.model("Client", clientSchema);
export default Client;
