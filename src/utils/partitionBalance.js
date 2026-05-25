import Partition from "../models/partition.models.js";
import mongoose from "mongoose";

export const applyPartitionDelta = async (partitionId, delta, session = null) => {
  const opts = session ? { session } : {};
  let query = Partition.findById(partitionId);
  if (session) query = query.session(session);
  const partition = await query;
  if (!partition) {
    const err = new Error("Partition not found");
    err.status = 404;
    throw err;
  }

  const next = Number(partition.balance) + Number(delta);
  if (next < 0) {
    const err = new Error("Insufficient balance in partition");
    err.status = 400;
    throw err;
  }

  partition.balance = next;
  await partition.save(opts);
  return partition;
};

export const validateAllocations = (amount, allocations) => {
  const total = (allocations || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
  if (Math.abs(total - Number(amount)) > 0.001) {
    const err = new Error("Partition allocations must equal the income amount");
    err.status = 400;
    throw err;
  }
};

export const withTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (e) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    const noTxnSupport =
      e.code === 20 ||
      e.message?.includes("replica set") ||
      e.message?.includes("Transaction numbers");
    if (noTxnSupport) {
      return fn(null);
    }
    throw e;
  } finally {
    session.endSession();
  }
};
