/** Product-shipping task workflow (canonical statuses). */
export const TASK_STATUSES = [
  "Backlog",
  "In Progress",
  "In Review",
  "Blocked",
  "Done",
  "Cancelled",
];

/** Legacy values still stored on older tasks — normalized on read/write. */
export const LEGACY_TASK_STATUSES = [
  "Pending",
  "Work In Progress",
  "Hold",
  "Completed",
];

export const ALL_TASK_STATUSES = [...TASK_STATUSES, ...LEGACY_TASK_STATUSES];

export const LEGACY_STATUS_MAP = {
  Pending: "Backlog",
  "Work In Progress": "In Progress",
  Hold: "Blocked",
  Completed: "Done",
};

export const TASK_TYPES = ["feature", "bug", "chore", "spike"];

export const TASK_PRIORITIES = ["Low", "Medium", "High", "Critical"];

/** Allowed next states from each canonical status. */
export const TASK_TRANSITIONS = {
  Backlog: ["In Progress", "Cancelled"],
  "In Progress": ["In Review", "Blocked", "Backlog", "Cancelled"],
  "In Review": ["Done", "In Progress", "Blocked"],
  Blocked: ["In Progress", "Backlog", "Cancelled"],
  Done: ["In Progress", "Backlog"],
  Cancelled: ["Backlog"],
};

/** Columns shown on the sprint board (Cancelled excluded). */
export const KANBAN_COLUMNS = ["Backlog", "In Progress", "In Review", "Blocked", "Done"];

export const STATUS_META = {
  Backlog: { label: "Backlog", color: "#94a3b8", order: 0 },
  "In Progress": { label: "In progress", color: "#00d4ff", order: 1 },
  "In Review": { label: "In review", color: "#a78bfa", order: 2 },
  Blocked: { label: "Blocked", color: "#f87171", order: 3 },
  Done: { label: "Done", color: "#00ff94", order: 4 },
  Cancelled: { label: "Cancelled", color: "#64748b", order: 5 },
};
