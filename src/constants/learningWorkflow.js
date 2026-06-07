/** Learning topic lifecycle statuses. */
export const LEARNING_TOPIC_STATUSES = [
  "pending",
  "learning",
  "on_hold",
  "review",
  "completed",
  "archived",
];

/** Kanban columns (archived excluded — use filter). */
export const LEARNING_BOARD_COLUMNS = [
  "pending",
  "learning",
  "on_hold",
  "review",
  "completed",
];

export const LEARNING_TOPIC_STATUS_LABELS = {
  pending: "Pending",
  learning: "Learning",
  on_hold: "On hold",
  review: "Review",
  completed: "Completed",
  archived: "Archived",
  // legacy
  draft: "Pending",
  active: "Learning",
};

export const LEGACY_LEARNING_STATUS_MAP = {
  draft: "pending",
  active: "learning",
  archived: "archived",
};

export const normalizeLearningTopicStatus = (status) => {
  if (!status) return "pending";
  if (LEGACY_LEARNING_STATUS_MAP[status]) return LEGACY_LEARNING_STATUS_MAP[status];
  if (LEARNING_TOPIC_STATUSES.includes(status)) return status;
  return "pending";
};

export const isValidLearningTopicStatus = (status) =>
  LEARNING_TOPIC_STATUSES.includes(status) || status in LEGACY_LEARNING_STATUS_MAP;
