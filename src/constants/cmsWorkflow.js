export const CONTENT_PRIORITIES = ["low", "medium", "high", "urgent"];

export const CONTENT_PRIORITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export const DEFAULT_PLATFORM_STATUSES = [
  { name: "Draft", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
  { name: "Script", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
  { name: "Recording", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
  { name: "Editing", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
  { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
  { name: "Published", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
];

export const isValidContentPriority = (value) =>
  CONTENT_PRIORITIES.includes(String(value || "").toLowerCase());

export const normalizeContentPriority = (value) => {
  const v = String(value || "medium").toLowerCase();
  return CONTENT_PRIORITIES.includes(v) ? v : "medium";
};
