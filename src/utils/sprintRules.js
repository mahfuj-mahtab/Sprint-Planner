import Sprint from "../models/sprint.models.js";
import { rangesOverlap, assertValidRange } from "./dateRanges.js";

export const assertSprintNoOverlap = async (orgId, projectId, startDate, endDate, excludeSprintId = null) => {
  const { start, end } = assertValidRange(startDate, endDate);
  const others = await Sprint.find({
    organization_id: orgId,
    project_id: projectId,
    ...(excludeSprintId ? { _id: { $ne: excludeSprintId } } : {}),
  });

  for (const s of others) {
    if (rangesOverlap(start, end, s.startDate, s.endDate)) {
      const err = new Error(`Sprint dates overlap with "${s.name}"`);
      err.status = 409;
      throw err;
    }
  }
  return { start, end };
};
