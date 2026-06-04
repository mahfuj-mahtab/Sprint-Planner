/** Product-shipping task workflow (canonical statuses). */
export const TASK_STATUSES = [
  "Pending",
  "Backlog",
  "In Progress",
  "In Review",
  "Blocked",
  "Done",
  "Cancelled",
];

/** Legacy values still stored on older tasks — normalized on read/write. */
export const LEGACY_TASK_STATUSES = [
  "Work In Progress",
  "Hold",
  "Completed",
];

export const ALL_TASK_STATUSES = [...TASK_STATUSES, ...LEGACY_TASK_STATUSES];

export const LEGACY_STATUS_MAP = {
  "Work In Progress": "In Progress",
  Hold: "Blocked",
  Completed: "Done",
};

export const TASK_TYPES = ["feature", "bug", "chore", "spike"];

export const TASK_PRIORITIES = ["Low", "Medium", "High", "Critical"];

/** Allowed next states from each canonical status. */
export const TASK_TRANSITIONS = {
  Pending: ["In Progress", "Backlog", "Cancelled"],
  Backlog: ["Pending", "In Progress", "Cancelled"],
  "In Progress": ["In Review", "Blocked", "Pending", "Backlog", "Cancelled"],
  "In Review": ["Done", "In Progress", "Blocked"],
  Blocked: ["In Progress", "Pending", "Backlog", "Cancelled"],
  Done: ["In Progress", "Pending", "Backlog"],
  Cancelled: ["Pending", "Backlog"],
};

/** Columns shown on the sprint board (Cancelled excluded). */
export const KANBAN_COLUMNS = ["Pending", "Backlog", "In Progress", "In Review", "Blocked", "Done"];

export const STATUS_META = {
  Pending: { label: "Pending", color: "#f59e0b", order: 0 },
  Backlog: { label: "Backlog", color: "#94a3b8", order: 1 },
  "In Progress": { label: "In progress", color: "#00d4ff", order: 2 },
  "In Review": { label: "In review", color: "#a78bfa", order: 3 },
  Blocked: { label: "Blocked", color: "#f87171", order: 4 },
  Done: { label: "Done", color: "#00ff94", order: 5 },
  Cancelled: { label: "Cancelled", color: "#64748b", order: 6 },
};
