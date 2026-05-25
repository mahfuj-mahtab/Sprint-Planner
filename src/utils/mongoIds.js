import mongoose from "mongoose";

export const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
};

/** Sum amounts by project_id from transaction docs (Mongoose find — reliable org filter). */
export const sumByProjectId = (docs) => {
  const map = {};
  for (const doc of docs) {
    if (!doc.project_id) continue;
    const key = doc.project_id.toString();
    map[key] = (map[key] || 0) + Number(doc.amount);
  }
  return map;
};
