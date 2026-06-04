import {
  TASK_STATUSES,
  LEGACY_STATUS_MAP,
  TASK_TRANSITIONS,
  ALL_TASK_STATUSES,
} from "../constants/taskWorkflow.js";

export const normalizeTaskStatus = (status) => {
  if (!status) return "Pending";
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status];
  if (TASK_STATUSES.includes(status)) return status;
  return "Pending";
};

export const isTaskDone = (status) => {
  const n = normalizeTaskStatus(status);
  return n === "Done";
};

export const isTaskTerminal = (status) => {
  const n = normalizeTaskStatus(status);
  return n === "Done" || n === "Cancelled";
};

export const isTaskActiveWork = (status) => {
  const n = normalizeTaskStatus(status);
  return n === "In Progress" || n === "In Review";
};

export const isTaskBlocked = (status) => normalizeTaskStatus(status) === "Blocked";

export const canTransitionTask = (fromStatus, toStatus) => {
  const from = normalizeTaskStatus(fromStatus);
  const to = normalizeTaskStatus(toStatus);
  if (from === to) return true;
  return (TASK_TRANSITIONS[from] || []).includes(to);
};

export const assertTaskTransition = (fromStatus, toStatus) => {
  if (!canTransitionTask(fromStatus, toStatus)) {
    const from = normalizeTaskStatus(fromStatus);
    const to = normalizeTaskStatus(toStatus);
    const allowed = TASK_TRANSITIONS[from] || [];
    const err = new Error(
      allowed.length
        ? `Cannot move from "${from}" to "${to}". Allowed: ${allowed.join(", ")}`
        : `Invalid status "${to}"`
    );
    err.status = 400;
    throw err;
  }
};

export const resolveTaskStatusForWrite = (status) => {
  const normalized = normalizeTaskStatus(status);
  if (!ALL_TASK_STATUSES.includes(status) && !TASK_STATUSES.includes(normalized)) {
    const err = new Error("Invalid task status");
    err.status = 400;
    throw err;
  }
  return normalized;
};

export const bucketTaskForMetrics = (status) => {
  const n = normalizeTaskStatus(status);
  if (n === "Done") return "completed";
  if (n === "Cancelled") return "cancelled";
  if (n === "In Progress" || n === "In Review") return "wip";
  if (n === "Blocked") return "blocked";
  return "pending";
};
