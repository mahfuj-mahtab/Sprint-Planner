/** Full project lifecycle statuses. */
export const PROJECT_STATUSES = [
  "backlog",
  "planning",
  "pending",
  "in_progress",
  "review",
  "on_hold",
  "completed",
  "delivered",
  "billed",
  "cancelled",
];

/** Kanban columns (cancelled excluded — use filter). */
export const PROJECT_BOARD_COLUMNS = [
  "backlog",
  "planning",
  "pending",
  "in_progress",
  "review",
  "on_hold",
  "completed",
  "delivered",
  "billed",
];

export const PROJECT_STATUS_LABELS = {
  backlog: "Backlog",
  planning: "Planning",
  pending: "Pending",
  in_progress: "In progress",
  review: "In review",
  on_hold: "On hold",
  completed: "Completed",
  delivered: "Delivered",
  billed: "Billed",
  cancelled: "Cancelled",
  // legacy
  active: "In progress",
  paused: "On hold",
};

export const LEGACY_PROJECT_STATUS_MAP = {
  active: "in_progress",
  paused: "on_hold",
  completed: "completed",
};

export const PROJECT_PRIORITIES = ["high", "medium", "low"];

export const PROJECT_PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2,
};

export const normalizeProjectStatus = (status) => {
  if (!status) return "pending";
  if (LEGACY_PROJECT_STATUS_MAP[status]) return LEGACY_PROJECT_STATUS_MAP[status];
  if (PROJECT_STATUSES.includes(status)) return status;
  return "pending";
};

export const isValidProjectStatus = (status) =>
  PROJECT_STATUSES.includes(status) || status in LEGACY_PROJECT_STATUS_MAP;
