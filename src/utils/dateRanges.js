export const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Inclusive range overlap (requires valid start <= end on each range). */
export const rangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const s1 = startOfDay(aStart).getTime();
  const e1 = endOfDay(aEnd).getTime();
  const s2 = startOfDay(bStart).getTime();
  const e2 = endOfDay(bEnd).getTime();
  if (e1 < s1 || e2 < s2) return false;
  return s1 <= e2 && s2 <= e1;
};

export const assertValidRange = (startDate, endDate) => {
  const start = startOfDay(startDate);
  const end = endOfDay(endDate);
  if (end < start) {
    const err = new Error("End date must be on or after start date");
    err.status = 400;
    throw err;
  }
  return { start, end };
};
