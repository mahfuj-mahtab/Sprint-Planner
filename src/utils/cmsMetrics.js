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

const startOfWeek = (d) => {
  const day = d.getDay();
  const diff = (day + 6) % 7; // monday as start
  const r = new Date(d);
  r.setDate(d.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
};

const startOfDay = (d) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

export const buildCmsDashboard = ({
  platforms,
  statuses,
  contentItems,
  analyticsDocs,
  pillars = [],
  goals = [],
  now = new Date(),
}) => {
  const statusById = new Map(statuses.map((s) => [s._id.toString(), s]));
  const platformById = new Map(platforms.map((p) => [p._id.toString(), p]));
  const pillarById = new Map(pillars.map((p) => [p._id.toString(), p]));
  const latestByContent = latestAnalyticsByContent(analyticsDocs);

  const overallLatest = sumMetrics([...latestByContent.values()]);
  const totalEngagement =
    overallLatest.likes +
    overallLatest.comments +
    overallLatest.shares +
    overallLatest.clicks;
  const engagementRate = overallLatest.views
    ? (totalEngagement / overallLatest.views) * 100
    : 0;

  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const publishedThisWeek = contentItems.filter((c) => {
    if (!c.published_at) return false;
    const d = new Date(c.published_at);
    return d >= weekStart && d <= now;
  }).length;
  const publishedThisMonth = contentItems.filter((c) => {
    if (!c.published_at) return false;
    const d = new Date(c.published_at);
    return d >= monthStart && d <= now;
  }).length;

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
    const eng =
      analytics.views > 0
        ? ((analytics.likes + analytics.comments + analytics.shares + analytics.clicks) /
            analytics.views) *
          100
        : 0;

    // Per-platform weekly + monthly publish counts
    const publishedWeek = items.filter((c) => {
      if (!c.published_at) return false;
      const d = new Date(c.published_at);
      return d >= weekStart && d <= now;
    }).length;
    const publishedMonth = items.filter((c) => {
      if (!c.published_at) return false;
      const d = new Date(c.published_at);
      return d >= monthStart && d <= now;
    }).length;

    // Follower growth (history vs current)
    const history = (platform.follower_history || []).slice().sort(
      (a, b) => new Date(a.at) - new Date(b.at)
    );
    const firstCount = history[0]?.count ?? platform.current_followers ?? 0;
    const lastCount = platform.current_followers ?? 0;
    const followerGrowth = lastCount - firstCount;
    const followerGrowthPct = firstCount
      ? (followerGrowth / firstCount) * 100
      : 0;

    // Pillar mix for platform
    const pillarCounts = {};
    for (const item of items) {
      if (item.pillar_id) {
        const k = item.pillar_id.toString();
        pillarCounts[k] = (pillarCounts[k] || 0) + 1;
      }
    }

    return {
      platform_id: platform._id,
      name: platform.name,
      color: platform.color,
      icon: platform.icon || "other",
      platform_type: platform.platform_type || "mixed",
      account_handle: platform.account_handle || "",
      account_url: platform.account_url || "",
      niche: platform.niche || "",
      current_followers: lastCount,
      follower_growth: followerGrowth,
      follower_growth_pct: followerGrowthPct,
      engagement_rate: eng,
      total_content: items.length,
      scheduled_count: scheduled,
      published_count: published,
      published_this_week: publishedWeek,
      published_this_month: publishedMonth,
      by_status: platformStatuses.map((s) => ({
        status_id: s._id,
        name: s.name,
        color: s.color,
        count: byStatus[s._id.toString()] || 0,
      })),
      pillar_mix: Object.entries(pillarCounts).map(([k, v]) => ({
        pillar_id: k,
        name: pillarById.get(k)?.name || "Unnamed",
        color: pillarById.get(k)?.color || "#94a3b8",
        count: v,
      })),
      analytics,
    };
  });

  // Best time to post: which day-of-week and hour do published pieces land on, weighted by views.
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill({ count: 0, weight: 0 }));
  for (const item of contentItems) {
    if (!item.published_at) continue;
    const d = new Date(item.published_at);
    const day = d.getDay();
    const hour = d.getHours();
    const latest = latestByContent.get(item._id.toString());
    const weight = latest ? (latest.views || 0) + (latest.likes || 0) * 2 : 1;
    const cell = heatmap[day][hour];
    heatmap[day][hour] = { count: cell.count + 1, weight: cell.weight + weight };
  }

  // Top performers (by total views, fall back to engagement)
  const topPerformers = contentItems
    .map((c) => {
      const latest = latestByContent.get(c._id.toString());
      return {
        content: c,
        platform: platformById.get(c.platform_id.toString()) || null,
        latest,
        score: latest
          ? (latest.views || 0) + (latest.likes || 0) * 5 + (latest.comments || 0) * 8 + (latest.shares || 0) * 12
          : 0,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Weekly publish trend for last 8 weeks
  const weeklyTrend = [];
  for (let i = 7; i >= 0; i -= 1) {
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() - i * 7);
    const we = new Date(ws);
    we.setDate(we.getDate() + 7);
    const published = contentItems.filter((c) => {
      if (!c.published_at) return false;
      const d = new Date(c.published_at);
      return d >= ws && d < we;
    }).length;
    const views = analyticsDocs
      .filter((a) => {
        const d = new Date(a.recorded_at);
        return d >= ws && d < we;
      })
      .reduce((s, a) => s + (a.views || 0), 0);
    weeklyTrend.push({
      week_start: ws.toISOString(),
      label: ws.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      published,
      views,
    });
  }

  // Pillar distribution
  const pillarDistribution = pillars.map((p) => {
    const count = contentItems.filter(
      (c) => c.pillar_id && c.pillar_id.toString() === p._id.toString()
    ).length;
    return {
      pillar_id: p._id,
      name: p.name,
      color: p.color,
      count,
      target_share: p.target_share,
    };
  });

  const upcoming = contentItems
    .filter((c) => c.scheduled_at && new Date(c.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 12)
    .map((c) => ({
      ...c,
      platform_name: platformById.get(c.platform_id.toString())?.name || "",
      platform_color: platformById.get(c.platform_id.toString())?.color || "#94a3b8",
      status_name: statusById.get(c.status_id.toString())?.name || "",
    }));

  const recent = contentItems
    .filter((c) => c.published_at)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, 8)
    .map((c) => ({
      ...c,
      platform_name: platformById.get(c.platform_id.toString())?.name || "",
      platform_color: platformById.get(c.platform_id.toString())?.color || "#94a3b8",
      latest: latestByContent.get(c._id.toString()) || null,
    }));

  // Goals summary
  const activeGoals = goals.filter((g) => !g.is_archived && !g.achieved_at);
  const goalsSummary = activeGoals.map((g) => {
    const platform = g.platform_id ? platformById.get(g.platform_id.toString()) : null;
    let currentValue = g.start_value;
    if (g.metric === "followers" || g.metric === "subscribers") {
      currentValue = platform?.current_followers ?? g.start_value;
    } else if (g.metric === "views") {
      currentValue = overallLatest.views;
    } else if (g.metric === "posts_published") {
      currentValue = contentItems.filter((c) => c.published_at).length;
    } else if (g.metric === "engagement_rate") {
      currentValue = engagementRate;
    }
    const span = Math.max(1, g.target_value - g.start_value);
    const progress = Math.max(0, Math.min(100, ((currentValue - g.start_value) / span) * 100));
    const daysLeft = g.target_date
      ? Math.ceil((new Date(g.target_date) - now) / (1000 * 60 * 60 * 24))
      : null;
    return {
      ...g.toObject ? g.toObject() : g,
      platform_name: platform?.name || "All platforms",
      platform_color: platform?.color || "#94a3b8",
      current_value: currentValue,
      progress,
      progress_pct: progress,
      days_left: daysLeft,
      on_track:
        g.target_date && daysLeft !== null && daysLeft > 0
          ? currentValue >= g.start_value + (span * (1 - daysLeft / 90))
          : null,
    };
  });

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const heatmapHours = Array.from({ length: 24 }, (_, h) =>
    h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`
  );
  const maxHeat = Math.max(...heatmap.flat().map((c) => c.weight), 1);
  const heatmapUi = {
    weekday: weekdayLabels,
    hours: heatmapHours,
    values: heatmap.map((row) => row.map((cell) => cell.weight / maxHeat)),
  };

  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = startOfDay(d);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const published = contentItems.filter((c) => {
      if (!c.published_at) return false;
      const pd = new Date(c.published_at);
      return pd >= dayStart && pd < dayEnd;
    }).length;
    const scheduled = contentItems.filter((c) => {
      if (!c.scheduled_at) return false;
      const sd = new Date(c.scheduled_at);
      return sd >= dayStart && sd < dayEnd;
    }).length;
    last7Days.push({
      day: d.toLocaleDateString(undefined, { weekday: "short" }),
      published,
      scheduled,
    });
  }

  const flatTopPerformers = topPerformers.map((t) => {
    const latest = t.latest;
    const views = latest?.views || 0;
    const eng =
      views > 0
        ? (((latest?.likes || 0) + (latest?.comments || 0) + (latest?.shares || 0)) / views) * 100
        : 0;
    return {
      _id: t.content._id,
      title: t.content.title,
      platform_name: t.platform?.name || "",
      platform_color: t.platform?.color || "#94a3b8",
      views,
      engagement_rate: eng,
    };
  });

  const achievedGoals = goals.filter((g) => g.achieved_at);
  const activeGoalsList = goalsSummary.filter((g) => !g.achieved_at);

  const recentFlat = recent.map((c) => ({
    _id: c._id,
    title: c.title,
    platform_name: c.platform_name,
    published_at: c.published_at,
    views: c.latest?.views || 0,
  }));

  return {
    summary: {
      platform_count: platforms.length,
      active_platforms: platforms.filter((p) => p.is_active).length,
      content_count: contentItems.length,
      scheduled_count: contentItems.filter((c) => c.scheduled_at).length,
      published_count: contentItems.filter((c) => {
        const st = statusById.get(c.status_id.toString());
        return st?.is_published_stage || c.published_at;
      }).length,
      published_this_week: publishedThisWeek,
      published_this_month: publishedThisMonth,
      pillar_count: pillars.length,
      active_goals: activeGoals.length,
      analytics_snapshots: analyticsDocs.length,
      total_followers: byPlatform.reduce((s, p) => s + (p.current_followers || 0), 0),
      follower_growth: byPlatform.reduce((s, p) => s + (p.follower_growth || 0), 0),
      ...overallLatest,
      engagement_rate: engagementRate,
    },
    by_platform: byPlatform,
    upcoming_scheduled: upcoming,
    recent_published: recentFlat,
    top_performers: flatTopPerformers,
    weekly_trend: last7Days,
    pillar_distribution: pillarDistribution,
    heatmap: heatmapUi,
    goals: {
      active: activeGoalsList,
      achieved: achievedGoals.map((g) => ({
        ...g,
        platform_name: g.platform_id
          ? platformById.get(g.platform_id.toString())?.name || ""
          : "All platforms",
      })),
    },
    journey: byPlatform.map((p) => ({
      platform_id: p.platform_id,
      name: p.name,
      icon: p.icon,
      color: p.color,
      platform_type: p.platform_type,
      account_handle: p.account_handle,
      current_followers: p.current_followers,
      follower_growth: p.follower_growth,
      follower_growth_pct: p.follower_growth_pct,
      engagement_rate: p.engagement_rate,
      total_content: p.total_content,
      published_this_month: p.published_this_month,
    })),
  };
};

/** Group content by ISO date string for the calendar view. */
export const buildCmsCalendar = ({ contentItems, platforms = [], start, end, kind = "all" }) => {
  const startDate = startOfDay(new Date(start));
  const endDate = startOfDay(new Date(end));
  const map = new Map();
  const platformById = new Map(platforms.map((p) => [p._id.toString(), p]));

  for (const c of contentItems) {
    const dates = [];
    if (c.scheduled_at && (kind === "all" || kind === "scheduled")) {
      dates.push({ kind: "scheduled", at: c.scheduled_at });
    }
    if (c.published_at && (kind === "all" || kind === "published")) {
      dates.push({ kind: "published", at: c.published_at });
    }
    for (const d of dates) {
      const dt = new Date(d.at);
      if (dt < startDate || dt > endDate) continue;
      const key = dt.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      const platform = platformById.get(c.platform_id.toString()) || null;
      map.get(key).push({
        _id: c._id,
        title: c.title,
        priority: c.priority,
        kind: d.kind,
        at: d.at,
        platform_id: c.platform_id,
        platform_name: platform?.name || "—",
        platform_color: platform?.color || "#94a3b8",
        platform_icon: platform?.icon || "other",
      });
    }
  }

  return Array.from(map.entries())
    .map(([date, items]) => ({ date, items }))
    .sort((a, b) => a.date.localeCompare(b.date));
};
