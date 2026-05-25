import ProjectVersion from "../models/projectVersion.models.js";
import { rangesOverlap, startOfDay, endOfDay, assertValidRange } from "./dateRanges.js";

export const VERSION_STATUSES = ["planned", "active", "completed"];

export const isVersionIncomplete = (v) => {
  if (!v.start_date || !v.end_date) return false;
  return v.status !== "completed";
};

export const deriveVersionStatus = (startDate, endDate, now = new Date()) => {
  const today = startOfDay(now);
  const start = startOfDay(startDate);
  const end = endOfDay(endDate);
  if (end < today) return "completed";
  if (start <= today && end >= today) return "active";
  return "planned";
};

export const pickCurrentVersion = (versions) => {
  if (!versions?.length) return null;
  const active = versions.find((v) => v.status === "active");
  if (active) return active;
  const today = startOfDay(new Date());
  return (
    versions.find((v) => {
      if (v.status === "completed" || !v.start_date || !v.end_date) return false;
      const start = startOfDay(v.start_date);
      const end = endOfDay(v.end_date);
      return start <= today && end >= today;
    }) || null
  );
};

export const findIncompleteVersions = (versions, excludeId = null) =>
  versions.filter(
    (v) => isVersionIncomplete(v) && (!excludeId || v._id.toString() !== excludeId.toString())
  );

export const assertCanCreateVersion = async (orgId, projectId) => {
  const existing = await ProjectVersion.find({ organization_id: orgId, project_id: projectId });
  const incomplete = findIncompleteVersions(existing);
  if (incomplete.length) {
    const err = new Error(
      `Complete version "${incomplete[0].name}" before creating a new one`
    );
    err.status = 409;
    throw err;
  }
};

export const assertVersionDateOverlap = async (orgId, projectId, startDate, endDate, excludeId = null) => {
  const { start, end } = assertValidRange(startDate, endDate);
  const others = await ProjectVersion.find({
    organization_id: orgId,
    project_id: projectId,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

  for (const v of others) {
    if (!v.start_date || !v.end_date) continue;
    if (rangesOverlap(start, end, v.start_date, v.end_date)) {
      const err = new Error(`Date range overlaps with version "${v.name}"`);
      err.status = 409;
      throw err;
    }
  }
  return { start, end };
};

export const assertVersionEditable = (version) => {
  if (version.is_locked) {
    const err = new Error("Version is locked. Unlock it to make changes.");
    err.status = 403;
    throw err;
  }
  if (version.status === "completed") {
    const err = new Error("Completed versions cannot be modified.");
    err.status = 403;
    throw err;
  }
};

export const assertVersionFeaturesMutable = (version) => {
  assertVersionEditable(version);
};
