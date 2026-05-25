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
