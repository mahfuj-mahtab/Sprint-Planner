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

export const CONTENT_FORMATS = [
  "video",
  "short",
  "reel",
  "post",
  "carousel",
  "story",
  "thread",
  "article",
  "podcast",
  "live",
  "newsletter",
];

/** Preset channels — icon key drives default workflow + styling. */
export const PLATFORM_PRESETS = {
  youtube: {
    name: "YouTube",
    icon: "youtube",
    platform_type: "video",
    color: "#ff0000",
    engagement_rate_target: 5,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Research", color: "#64748b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Script", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Record", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Edit", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Thumbnail", color: "#f472b6", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Published", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  instagram: {
    name: "Instagram",
    icon: "instagram",
    platform_type: "photo",
    color: "#e1306c",
    engagement_rate_target: 3,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Concept", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Shoot", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Edit", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Caption", color: "#f472b6", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Posted", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  tiktok: {
    name: "TikTok",
    icon: "tiktok",
    platform_type: "short",
    color: "#00f2ea",
    engagement_rate_target: 8,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Script", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Film", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Edit", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Posted", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  linkedin: {
    name: "LinkedIn",
    icon: "linkedin",
    platform_type: "text",
    color: "#0a66c2",
    engagement_rate_target: 2,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Outline", color: "#64748b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Draft", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Review", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Published", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  x: {
    name: "X",
    icon: "x",
    platform_type: "text",
    color: "#e7e9ea",
    engagement_rate_target: 1.5,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Draft", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Thread", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Posted", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  podcast: {
    name: "Podcast",
    icon: "podcast",
    platform_type: "audio",
    color: "#a855f7",
    engagement_rate_target: 4,
    statuses: [
      { name: "Topic", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Guest outreach", color: "#64748b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Record", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Edit", color: "#38bdf8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Show notes", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Published", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
  blog: {
    name: "Blog",
    icon: "blog",
    platform_type: "text",
    color: "#22c55e",
    engagement_rate_target: 2,
    statuses: [
      { name: "Idea", color: "#94a3b8", is_scheduled_stage: false, is_published_stage: false },
      { name: "Outline", color: "#64748b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Draft", color: "#a78bfa", is_scheduled_stage: false, is_published_stage: false },
      { name: "SEO review", color: "#f59e0b", is_scheduled_stage: false, is_published_stage: false },
      { name: "Scheduled", color: "#22d3ee", is_scheduled_stage: true, is_published_stage: false },
      { name: "Published", color: "#00ff94", is_scheduled_stage: false, is_published_stage: true },
    ],
  },
};

export const getPlatformPreset = (icon) =>
  PLATFORM_PRESETS[String(icon || "").toLowerCase()] || null;

export const getStatusesForIcon = (icon) =>
  getPlatformPreset(icon)?.statuses || DEFAULT_PLATFORM_STATUSES;

export const isValidContentFormat = (value) =>
  CONTENT_FORMATS.includes(String(value || "").toLowerCase());

export const normalizeContentFormat = (value) => {
  const v = String(value || "post").toLowerCase();
  return CONTENT_FORMATS.includes(v) ? v : "post";
};

export const PLATFORM_ICONS = [
  "youtube",
  "instagram",
  "tiktok",
  "x",
  "linkedin",
  "facebook",
  "podcast",
  "blog",
  "threads",
  "pinterest",
  "snapchat",
  "twitch",
  "medium",
  "github",
  "other",
];

export const PLATFORM_TYPES = [
  { id: "video", label: "Long-form video" },
  { id: "short", label: "Short-form video" },
  { id: "photo", label: "Photo / image" },
  { id: "text", label: "Text / article" },
  { id: "audio", label: "Audio / podcast" },
  { id: "mixed", label: "Mixed" },
];

export const GOAL_METRICS = [
  { id: "followers", label: "Followers" },
  { id: "subscribers", label: "Subscribers" },
  { id: "views", label: "Views (cumulative)" },
  { id: "posts_published", label: "Posts published" },
  { id: "engagement_rate", label: "Engagement rate %" },
];

export const isValidContentPriority = (value) =>
  CONTENT_PRIORITIES.includes(String(value || "").toLowerCase());

export const normalizeContentPriority = (value) => {
  const v = String(value || "medium").toLowerCase();
  return CONTENT_PRIORITIES.includes(v) ? v : "medium";
};
