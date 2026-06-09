const sumMetrics = (snapshots) => {
  const totals = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    clicks: 0,
    watch_time_minutes: 0,
    subscribers_gained: 0,
  };
  for (const s of snapshots) {
    totals.views += Number(s.views || 0);
    totals.likes += Number(s.likes || 0);
    totals.comments += Number(s.comments || 0);
    totals.shares += Number(s.shares || 0);
    totals.clicks += Number(s.clicks || 0);
    totals.watch_time_minutes += Number(s.watch_time_minutes || 0);
    totals.subscribers_gained += Number(s.subscribers_gained || 0);
  }
  return totals;
};

/** Latest snapshot per content item. */
export const latestAnalyticsByContent = (analyticsDocs) => {
  const map = new Map();
  for (const doc of analyticsDocs) {
    const id = doc.content_id.toString();
    const existing = map.get(id);
    if (!existing || new Date(doc.recorded_at) > new Date(existing.recorded_at)) {
      map.set(id, doc);
    }
  }
  return map;
};

export const buildCmsDashboard = ({
  platforms,
  statuses,
  contentItems,
  analyticsDocs,
  now = new Date(),
}) => {
  const statusById = new Map(statuses.map((s) => [s._id.toString(), s]));
  const platformById = new Map(platforms.map((p) => [p._id.toString(), p]));
  const latestByContent = latestAnalyticsByContent(analyticsDocs);

  const overallLatest = sumMetrics([...latestByContent.values()]);

  const byPlatform = platforms.map((platform) => {
    const pid = platform._id.toString();
    const platformStatuses = statuses
      .filter((s) => s.platform_id.toString() === pid)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const items = contentItems.filter((c) => c.platform_id.toString() === pid);
    const byStatus = Object.fromEntries(platformStatuses.map((s) => [s._id.toString(), 0]));
    let scheduled = 0;
    let published = 0;

    for (const item of items) {
      const sid = item.status_id.toString();
      if (byStatus[sid] !== undefined) byStatus[sid] += 1;
      const st = statusById.get(sid);
      if (st?.is_scheduled_stage || item.scheduled_at) scheduled += 1;
      if (st?.is_published_stage || item.published_at) published += 1;
    }

    const platformLatest = items
      .map((c) => latestByContent.get(c._id.toString()))
      .filter(Boolean);
    const analytics = sumMetrics(platformLatest);

    return {
      platform_id: platform._id,
      name: platform.name,
      color: platform.color,
      total_content: items.length,
      scheduled_count: scheduled,
      published_count: published,
      by_status: platformStatuses.map((s) => ({
        status_id: s._id,
        name: s.name,
        color: s.color,
        count: byStatus[s._id.toString()] || 0,
      })),
      analytics,
    };
  });

  const upcoming = contentItems
    .filter((c) => c.scheduled_at && new Date(c.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 12)
    .map((c) => ({
      ...c,
      platform_name: platformById.get(c.platform_id.toString())?.name || "",
    }));

  const statusTotals = {};
  for (const item of contentItems) {
    const sid = item.status_id.toString();
    statusTotals[sid] = (statusTotals[sid] || 0) + 1;
  }

  return {
    summary: {
      platform_count: platforms.length,
      content_count: contentItems.length,
      scheduled_count: contentItems.filter((c) => c.scheduled_at).length,
      published_count: contentItems.filter((c) => {
        const st = statusById.get(c.status_id.toString());
        return st?.is_published_stage || c.published_at;
      }).length,
      analytics_snapshots: analyticsDocs.length,
      ...overallLatest,
    },
    by_platform: byPlatform,
    upcoming_scheduled: upcoming,
    priority_breakdown: {
      low: contentItems.filter((c) => c.priority === "low").length,
      medium: contentItems.filter((c) => c.priority === "medium").length,
      high: contentItems.filter((c) => c.priority === "high").length,
      urgent: contentItems.filter((c) => c.priority === "urgent").length,
    },
  };
};
