const INTERVALS = ["weekly", "monthly", "quarterly", "yearly", "custom"];

export const BILLING_INTERVALS = INTERVALS;

export const intervalLabel = (interval, customDays) => {
  if (interval === "weekly") return "Weekly";
  if (interval === "monthly") return "Monthly";
  if (interval === "quarterly") return "Quarterly";
  if (interval === "yearly") return "Yearly";
  if (interval === "custom") return `Every ${customDays || 30} days`;
  return interval;
};

export const advanceDueDate = (fromDate, interval, customDays = 30) => {
  const d = new Date(fromDate);
  switch (interval) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "custom":
      d.setDate(d.getDate() + Math.max(1, Number(customDays) || 30));
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
};

export const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Due on or before today and not yet charged for this cycle. */
export const isSubscriptionDue = (sub, now = new Date()) => {
  if (sub.lifecycle === "planned") return false;
  if (!sub.is_active || !sub.auto_deduct) return false;
  const dueEnd = endOfDay(new Date(sub.next_due_date));
  if (dueEnd > endOfDay(now)) return false;
  if (!sub.last_charged_at) return true;
  const dueStart = startOfDay(new Date(sub.next_due_date));
  return new Date(sub.last_charged_at) < dueStart;
};

export const daysUntilDue = (nextDueDate, now = new Date()) => {
  const due = startOfDay(new Date(nextDueDate));
  const today = startOfDay(now);
  return Math.round((due - today) / (24 * 60 * 60 * 1000));
};

export const retreatDueDate = (fromDate, interval, customDays = 30) => {
  const d = new Date(fromDate);
  switch (interval) {
    case "weekly":
      d.setDate(d.getDate() - 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() - 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() - 3);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() - 1);
      break;
    case "custom":
      d.setDate(d.getDate() - Math.max(1, Number(customDays) || 30));
      break;
    default:
      d.setMonth(d.getMonth() - 1);
  }
  return d;
};

/** Normalized monthly cost for burn / forecast totals. */
export const monthlyEquivalent = (amount, interval, customDays = 30) => {
  const a = Number(amount) || 0;
  switch (interval) {
    case "weekly":
      return a * (52 / 12);
    case "monthly":
      return a;
    case "quarterly":
      return a / 3;
    case "yearly":
      return a / 12;
    case "custom":
      return a * (30 / Math.max(1, Number(customDays) || 30));
    default:
      return a;
  }
};

export const yearlyEquivalent = (amount, interval, customDays) =>
  monthlyEquivalent(amount, interval, customDays) * 12;

const monthKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (d) =>
  d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

/** First charge anchor for forecasting. */
const forecastAnchor = (sub) => {
  if (sub.lifecycle === "planned" && sub.planned_start_date) {
    return startOfDay(new Date(sub.planned_start_date));
  }
  if (sub.next_due_date) return startOfDay(new Date(sub.next_due_date));
  if (sub.createdAt) return startOfDay(new Date(sub.createdAt));
  return startOfDay(new Date());
};

/** All charge dates for a subscription within [rangeStart, rangeEnd] (inclusive). */
export const chargesInRange = (sub, rangeStart, rangeEnd) => {
  if (!sub.is_active) return [];
  if (sub.lifecycle === "planned" && !sub.planned_start_date) {
    // Planned with no start: include in forecast from range start
  } else if (sub.lifecycle === "planned" && sub.planned_start_date) {
    const ps = startOfDay(new Date(sub.planned_start_date));
    if (ps > rangeEnd) return [];
  }

  const rs = startOfDay(rangeStart);
  const re = endOfDay(rangeEnd);
  let cursor = forecastAnchor(sub);

  const maxBack = 120;
  let i = 0;
  while (cursor > rs && i < maxBack) {
    cursor = retreatDueDate(cursor, sub.billing_interval, sub.custom_interval_days);
    i += 1;
  }

  const out = [];
  let guard = 0;
  while (cursor <= re && guard < 500) {
    if (cursor >= rs) {
      out.push({ date: new Date(cursor), amount: Number(sub.amount) || 0 });
    }
    cursor = advanceDueDate(cursor, sub.billing_interval, sub.custom_interval_days);
    guard += 1;
  }
  return out;
};

export const chargesInMonth = (sub, year, monthIndex) => {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return chargesInRange(sub, start, end);
};

export const buildMonthKeys = (count = 12, from = new Date()) => {
  const keys = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i += 1) {
    const x = new Date(d.getFullYear(), d.getMonth() + i, 1);
    keys.push({
      key: monthKey(x),
      label: monthLabel(x),
      year: x.getFullYear(),
      month: x.getMonth(),
    });
  }
  return keys;
};

export { monthKey, monthLabel };
