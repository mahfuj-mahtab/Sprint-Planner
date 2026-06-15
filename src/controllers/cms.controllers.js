import ContentPlatform from "../models/contentPlatform.models.js";
import ContentPlatformStatus from "../models/contentPlatformStatus.models.js";
import ContentItem from "../models/contentItem.models.js";
import ContentAnalytics from "../models/contentAnalytics.models.js";
import ContentPillar from "../models/contentPillar.models.js";
import ContentTemplate from "../models/contentTemplate.models.js";
import ContentGoal from "../models/contentGoal.models.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import {
  DEFAULT_PLATFORM_STATUSES,
  getPlatformPreset,
  getStatusesForIcon,
  isValidContentPriority,
  isValidContentFormat,
  normalizeContentPriority,
  normalizeContentFormat,
} from "../constants/cmsWorkflow.js";
import {
  buildCmsDashboard,
  buildCmsCalendar,
  latestAnalyticsByContent,
} from "../utils/cmsMetrics.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const parseDate = (value) => {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("Invalid date");
    err.status = 400;
    throw err;
  }
  return d;
};

const serializeContent = (doc, extras = {}) => {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.priority = normalizeContentPriority(obj.priority);
  obj.content_format = normalizeContentFormat(obj.content_format);
  return { ...obj, ...extras };
};

const parseStringList = (value) => {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,#\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
  }
  return undefined;
};

const applyContentFields = (content, body) => {
  if (body?.title !== undefined) content.title = String(body.title).trim();
  if (body?.description !== undefined) content.description = String(body.description).trim();
  if (body?.hook !== undefined) content.hook = String(body.hook).trim();
  if (body?.script_body !== undefined) content.script_body = String(body.script_body).trim();
  if (body?.notes !== undefined) content.notes = String(body.notes).trim();
  if (body?.cta !== undefined) content.cta = String(body.cta).trim();
  if (body?.series_name !== undefined) content.series_name = String(body.series_name).trim();
  if (body?.media_url !== undefined) content.media_url = String(body.media_url).trim();
  if (body?.published_url !== undefined) content.published_url = String(body.published_url).trim();
  if (body?.content_format !== undefined) {
    if (!isValidContentFormat(body.content_format)) {
      const err = new Error("Invalid content format");
      err.status = 400;
      throw err;
    }
    content.content_format = normalizeContentFormat(body.content_format);
  }
  if (body?.priority !== undefined) {
    if (!isValidContentPriority(body.priority)) {
      const err = new Error("Invalid priority");
      err.status = 400;
      throw err;
    }
    content.priority = normalizeContentPriority(body.priority);
  }
  if (body?.tags !== undefined) content.tags = parseStringList(body.tags) || [];
  if (body?.hashtags !== undefined) content.hashtags = parseStringList(body.hashtags) || [];
  if (body?.scheduled_at !== undefined) content.scheduled_at = parseDate(body.scheduled_at);
  if (body?.published_at !== undefined) content.published_at = parseDate(body.published_at);
  if (body?.sort_order !== undefined) content.sort_order = Number(body.sort_order) || 0;
  if (body?.checklist !== undefined) {
    content.checklist = Array.isArray(body.checklist)
      ? body.checklist
          .filter((c) => c && c.label)
          .map((c) => ({ label: String(c.label).trim(), done: Boolean(c.done) }))
      : [];
  }
};

const loadPlatform = async (orgId, platformId) => {
  const platform = await ContentPlatform.findOne({
    _id: platformId,
    organization_id: orgId,
  });
  if (!platform) {
    const err = new Error("Platform not found");
    err.status = 404;
    throw err;
  }
  return platform;
};

const loadStatus = async (orgId, statusId) => {
  const status = await ContentPlatformStatus.findOne({
    _id: statusId,
    organization_id: orgId,
  });
  if (!status) {
    const err = new Error("Status not found");
    err.status = 404;
    throw err;
  }
  return status;
};

const loadContent = async (orgId, contentId) => {
  const content = await ContentItem.findOne({
    _id: contentId,
    organization_id: orgId,
  });
  if (!content) {
    const err = new Error("Content not found");
    err.status = 404;
    throw err;
  }
  return content;
};

const seedDefaultStatuses = async (orgId, platformId, icon = "other") => {
  const statusDefs = getStatusesForIcon(icon);
  const docs = statusDefs.map((s, i) => ({
    organization_id: orgId,
    platform_id: platformId,
    name: s.name,
    color: s.color,
    sort_order: i,
    is_scheduled_stage: s.is_scheduled_stage,
    is_published_stage: s.is_published_stage,
  }));
  return ContentPlatformStatus.insertMany(docs);
};

const cascadeDeletePlatform = async (orgId, platformId) => {
  const contentIds = (
    await ContentItem.find({ organization_id: orgId, platform_id: platformId }).select("_id")
  ).map((c) => c._id);
  if (contentIds.length) {
    await ContentAnalytics.deleteMany({ organization_id: orgId, content_id: { $in: contentIds } });
    await ContentItem.deleteMany({ organization_id: orgId, platform_id: platformId });
  }
  await ContentPillar.deleteMany({ organization_id: orgId, platform_id: platformId });
  await ContentPlatformStatus.deleteMany({ organization_id: orgId, platform_id: platformId });
  await ContentPlatform.deleteOne({ _id: platformId, organization_id: orgId });
};

export const cmsOverview = async (req, res) => {
  const { orgId } = req.params;
  try {
    const { access } = await getOrgForMember(orgId, req.user._id);

    const platforms = await ContentPlatform.find({ organization_id: orgId }).sort({
      sort_order: 1,
      name: 1,
    });
    const statuses = await ContentPlatformStatus.find({ organization_id: orgId }).sort({
      sort_order: 1,
      name: 1,
    });
    const contentItems = await ContentItem.find({ organization_id: orgId }).sort({
      sort_order: 1,
      createdAt: -1,
    });
    const analyticsDocs = await ContentAnalytics.find({ organization_id: orgId }).sort({
      recorded_at: -1,
    });
    const pillars = await ContentPillar.find({ organization_id: orgId }).sort({
      sort_order: 1,
      name: 1,
    });
    const templates = await ContentTemplate.find({ organization_id: orgId }).sort({
      sort_order: 1,
      name: 1,
    });
    const goals = await ContentGoal.find({ organization_id: orgId, is_archived: false }).sort({
      createdAt: -1,
    });

    const latestMap = latestAnalyticsByContent(analyticsDocs);
    const pillarMap = new Map(pillars.map((p) => [p._id.toString(), p]));
    const enrichedContent = contentItems.map((c) => {
      const pillar = c.pillar_id ? pillarMap.get(c.pillar_id.toString()) : null;
      return serializeContent(c, {
        latest_analytics: latestMap.get(c._id.toString()) || null,
        analytics_count: analyticsDocs.filter(
          (a) => a.content_id.toString() === c._id.toString()
        ).length,
        pillar_name: pillar?.name || null,
        pillar_color: pillar?.color || null,
      });
    });

    const statusesByPlatform = {};
    for (const s of statuses) {
      const pid = s.platform_id.toString();
      if (!statusesByPlatform[pid]) statusesByPlatform[pid] = [];
      statusesByPlatform[pid].push(s);
    }

    const contentByPlatform = {};
    for (const c of enrichedContent) {
      const pid = c.platform_id.toString();
      if (!contentByPlatform[pid]) contentByPlatform[pid] = [];
      contentByPlatform[pid].push(c);
    }

    const pillarsByPlatform = {};
    for (const p of pillars) {
      const pid = p.platform_id.toString();
      if (!pillarsByPlatform[pid]) pillarsByPlatform[pid] = [];
      pillarsByPlatform[pid].push(p);
    }

    const enrichedPlatforms = platforms.map((p) => ({
      ...p.toObject(),
      statuses: statusesByPlatform[p._id.toString()] || [],
      content: contentByPlatform[p._id.toString()] || [],
      pillars: pillarsByPlatform[p._id.toString()] || [],
    }));

    return res.status(200).json({
      success: true,
      platforms: enrichedPlatforms,
      templates,
      goals,
      can_write: access.canWrite,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const cmsDashboard = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);

    const [platforms, statuses, contentItems, analyticsDocs, pillars, goals] = await Promise.all([
      ContentPlatform.find({ organization_id: orgId }).lean(),
      ContentPlatformStatus.find({ organization_id: orgId }).lean(),
      ContentItem.find({ organization_id: orgId }).lean(),
      ContentAnalytics.find({ organization_id: orgId }).lean(),
      ContentPillar.find({ organization_id: orgId }).lean(),
      ContentGoal.find({ organization_id: orgId, is_archived: false }).lean(),
    ]);

    const dashboard = buildCmsDashboard({
      platforms,
      statuses,
      contentItems,
      analyticsDocs,
      pillars,
      goals,
    });

    return res.status(200).json({ success: true, dashboard });
  } catch (error) {
    return handleError(res, error);
  }
};

export const cmsCalendar = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);

    const start = req.query?.start;
    const end = req.query?.end;
    if (!start || !end) {
      return res.status(400).json({ message: "start and end are required", success: false });
    }

    const platformId = String(req.query?.platform_id || "").trim();
    const kind = String(req.query?.kind || "all").trim();

    const contentFilter = { organization_id: orgId };
    if (platformId) {
      contentFilter.platform_id = platformId;
    }

    const [contentItems, platforms] = await Promise.all([
      ContentItem.find(contentFilter).lean(),
      ContentPlatform.find({ organization_id: orgId }).lean(),
    ]);

    const days = buildCmsCalendar({ contentItems, platforms, start, end, kind });
    return res.status(200).json({ success: true, days });
  } catch (error) {
    return handleError(res, error);
  }
};

export const platformCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Platform name is required", success: false });
    }

    const existing = await ContentPlatform.findOne({ organization_id: orgId, name });
    if (existing) {
      return res.status(409).json({ message: "Platform already exists", success: false });
    }

    const count = await ContentPlatform.countDocuments({ organization_id: orgId });
    const icon = String(req.body?.icon || "other").trim().toLowerCase();
    const preset = getPlatformPreset(icon);

    const platform = await ContentPlatform.create({
      organization_id: orgId,
      name: name || preset?.name || "Channel",
      description: String(req.body?.description || "").trim(),
      color: String(req.body?.color || preset?.color || "#a78bfa").trim(),
      icon,
      platform_type: String(req.body?.platform_type || preset?.platform_type || "mixed").trim(),
      account_handle: String(req.body?.account_handle || "").trim(),
      account_url: String(req.body?.account_url || "").trim(),
      niche: String(req.body?.niche || "").trim(),
      current_followers: Math.max(0, Number(req.body?.current_followers) || 0),
      engagement_rate_target: Math.max(
        0,
        Number(req.body?.engagement_rate_target) || preset?.engagement_rate_target || 4
      ),
      sort_order: count,
      is_active: req.body?.is_active !== false,
    });

    const statuses = await seedDefaultStatuses(orgId, platform._id, icon);

    return res.status(201).json({
      success: true,
      message: "Platform created with default workflow statuses",
      platform: { ...platform.toObject(), statuses },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const platformUpdate = async (req, res) => {
  const { orgId, platformId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const platform = await loadPlatform(orgId, platformId);

    const textFields = [
      "name",
      "description",
      "color",
      "icon",
      "platform_type",
      "account_handle",
      "account_url",
      "niche",
    ];
    for (const key of textFields) {
      if (req.body?.[key] !== undefined) platform[key] = String(req.body[key]).trim();
    }
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        return res.status(400).json({ message: "Platform name is required", success: false });
      }
      const dup = await ContentPlatform.findOne({
        organization_id: orgId,
        name,
        _id: { $ne: platformId },
      });
      if (dup) {
        return res.status(409).json({ message: "Platform name already in use", success: false });
      }
      platform.name = name;
    }
    if (req.body?.sort_order !== undefined) platform.sort_order = Number(req.body.sort_order) || 0;
    if (req.body?.is_active !== undefined) platform.is_active = Boolean(req.body.is_active);
    if (req.body?.engagement_rate_target !== undefined) {
      platform.engagement_rate_target = Math.max(0, Number(req.body.engagement_rate_target) || 0);
    }

    if (req.body?.current_followers !== undefined) {
      const newCount = Math.max(0, Number(req.body.current_followers) || 0);
      if (newCount !== platform.current_followers) {
        platform.follower_history.push({ at: new Date(), count: newCount });
      }
      platform.current_followers = newCount;
    }

    if (Array.isArray(req.body?.follower_history_append)) {
      for (const point of req.body.follower_history_append) {
        if (!point) continue;
        const at = point.at ? new Date(point.at) : new Date();
        const count = Math.max(0, Number(point.count) || 0);
        if (Number.isNaN(at.getTime())) continue;
        platform.follower_history.push({ at, count });
      }
    }

    await platform.save();
    return res.status(200).json({ success: true, message: "Platform updated", platform });
  } catch (error) {
    return handleError(res, error);
  }
};

export const platformDelete = async (req, res) => {
  const { orgId, platformId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    await loadPlatform(orgId, platformId);
    await cascadeDeletePlatform(orgId, platformId);
    return res.status(200).json({ success: true, message: "Platform and all content removed" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const statusCreate = async (req, res) => {
  const { orgId, platformId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    await loadPlatform(orgId, platformId);

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Status name is required", success: false });
    }

    const dup = await ContentPlatformStatus.findOne({
      organization_id: orgId,
      platform_id: platformId,
      name,
    });
    if (dup) {
      return res.status(409).json({ message: "Status already exists on this platform", success: false });
    }

    const count = await ContentPlatformStatus.countDocuments({
      organization_id: orgId,
      platform_id: platformId,
    });

    const status = await ContentPlatformStatus.create({
      organization_id: orgId,
      platform_id: platformId,
      name,
      color: String(req.body?.color || "#94a3b8").trim(),
      sort_order: req.body?.sort_order ?? count,
      is_scheduled_stage: Boolean(req.body?.is_scheduled_stage),
      is_published_stage: Boolean(req.body?.is_published_stage),
    });

    return res.status(201).json({ success: true, message: "Status created", status });
  } catch (error) {
    return handleError(res, error);
  }
};

export const statusUpdate = async (req, res) => {
  const { orgId, statusId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const status = await loadStatus(orgId, statusId);

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        return res.status(400).json({ message: "Status name is required", success: false });
      }
      const dup = await ContentPlatformStatus.findOne({
        organization_id: orgId,
        platform_id: status.platform_id,
        name,
        _id: { $ne: statusId },
      });
      if (dup) {
        return res.status(409).json({ message: "Status name already in use", success: false });
      }
      status.name = name;
    }
    if (req.body?.color !== undefined) status.color = String(req.body.color).trim();
    if (req.body?.sort_order !== undefined) status.sort_order = Number(req.body.sort_order) || 0;
    if (req.body?.is_scheduled_stage !== undefined) {
      status.is_scheduled_stage = Boolean(req.body.is_scheduled_stage);
    }
    if (req.body?.is_published_stage !== undefined) {
      status.is_published_stage = Boolean(req.body.is_published_stage);
    }

    await status.save();
    return res.status(200).json({ success: true, message: "Status updated", status });
  } catch (error) {
    return handleError(res, error);
  }
};

export const statusDelete = async (req, res) => {
  const { orgId, statusId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const status = await loadStatus(orgId, statusId);

    const statusCount = await ContentPlatformStatus.countDocuments({
      organization_id: orgId,
      platform_id: status.platform_id,
    });
    if (statusCount <= 1) {
      return res.status(400).json({
        message: "Cannot delete the only status — add another status first",
        success: false,
      });
    }

    const inUse = await ContentItem.countDocuments({
      organization_id: orgId,
      status_id: statusId,
    });

    let fallback = null;
    if (inUse > 0) {
      fallback = await ContentPlatformStatus.findOne({
        organization_id: orgId,
        platform_id: status.platform_id,
        _id: { $ne: statusId },
      }).sort({ sort_order: 1 });
      await ContentItem.updateMany(
        { organization_id: orgId, status_id: statusId },
        { status_id: fallback._id }
      );
    }

    await ContentPlatformStatus.deleteOne({ _id: statusId, organization_id: orgId });
    return res.status(200).json({
      success: true,
      message: inUse
        ? `Status deleted — ${inUse} item(s) moved to "${fallback?.name || "another"}" column`
        : "Status deleted",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const statusReorder = async (req, res) => {
  const { orgId, platformId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    await loadPlatform(orgId, platformId);

    const order = req.body?.order;
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ message: "order must be a non-empty array of status IDs", success: false });
    }

    const statuses = await ContentPlatformStatus.find({
      organization_id: orgId,
      platform_id: platformId,
    });
    const validIds = new Set(statuses.map((s) => s._id.toString()));
    for (const id of order) {
      if (!validIds.has(String(id))) {
        return res.status(400).json({ message: "Invalid status ID in order", success: false });
      }
    }

    await Promise.all(
      order.map((id, index) =>
        ContentPlatformStatus.updateOne(
          { _id: id, organization_id: orgId, platform_id: platformId },
          { sort_order: index }
        )
      )
    );

    const updated = await ContentPlatformStatus.find({
      organization_id: orgId,
      platform_id: platformId,
    }).sort({ sort_order: 1 });

    return res.status(200).json({ success: true, message: "Statuses reordered", statuses: updated });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);

    const platformId = req.body?.platform_id;
    const statusId = req.body?.status_id;
    const title = String(req.body?.title || "").trim();
    if (!platformId || !statusId || !title) {
      return res.status(400).json({
        message: "platform_id, status_id, and title are required",
        success: false,
      });
    }

    await loadPlatform(orgId, platformId);
    const status = await loadStatus(orgId, statusId);
    if (status.platform_id.toString() !== String(platformId)) {
      return res.status(400).json({ message: "Status does not belong to platform", success: false });
    }

    const priority = req.body?.priority
      ? normalizeContentPriority(req.body.priority)
      : "medium";
    if (req.body?.priority && !isValidContentPriority(req.body.priority)) {
      return res.status(400).json({ message: "Invalid priority", success: false });
    }

    if (req.body?.pillar_id) {
      const pillar = await ContentPillar.findOne({
        _id: req.body.pillar_id,
        organization_id: orgId,
      });
      if (!pillar) {
        return res.status(400).json({ message: "Pillar not found", success: false });
      }
    }

    const count = await ContentItem.countDocuments({
      organization_id: orgId,
      platform_id: platformId,
      status_id: statusId,
    });

    const scheduled_at = parseDate(req.body?.scheduled_at);
    const published_at = parseDate(req.body?.published_at);

    const content = await ContentItem.create({
      organization_id: orgId,
      platform_id: platformId,
      status_id: statusId,
      pillar_id: req.body?.pillar_id || null,
      title,
      description: String(req.body?.description || "").trim(),
      hook: String(req.body?.hook || "").trim(),
      script_body: String(req.body?.script_body || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      content_format: normalizeContentFormat(req.body?.content_format),
      priority,
      tags: parseStringList(req.body?.tags) || [],
      hashtags: parseStringList(req.body?.hashtags) || [],
      cta: String(req.body?.cta || "").trim(),
      series_name: String(req.body?.series_name || "").trim(),
      media_url: String(req.body?.media_url || "").trim(),
      published_url: String(req.body?.published_url || "").trim(),
      repurpose_of: req.body?.repurpose_of || null,
      checklist: Array.isArray(req.body?.checklist)
        ? req.body.checklist
            .filter((c) => c && c.label)
            .map((c) => ({ label: String(c.label).trim(), done: Boolean(c.done) }))
        : [],
      scheduled_at: scheduled_at === undefined ? null : scheduled_at,
      published_at: published_at === undefined ? null : published_at,
      sort_order: count,
      created_by: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Content created",
      content: serializeContent(content),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentUpdate = async (req, res) => {
  const { orgId, contentId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const content = await loadContent(orgId, contentId);

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) {
        return res.status(400).json({ message: "Title is required", success: false });
      }
    }
    applyContentFields(content, req.body);

    if (req.body?.pillar_id !== undefined) {
      if (req.body.pillar_id === null || req.body.pillar_id === "") {
        content.pillar_id = null;
      } else {
        const pillar = await ContentPillar.findOne({
          _id: req.body.pillar_id,
          organization_id: orgId,
        });
        if (!pillar) {
          return res.status(400).json({ message: "Pillar not found", success: false });
        }
        content.pillar_id = pillar._id;
      }
    }

    if (req.body?.status_id !== undefined) {
      const status = await loadStatus(orgId, req.body.status_id);
      if (status.platform_id.toString() !== content.platform_id.toString()) {
        return res.status(400).json({ message: "Status does not belong to content platform", success: false });
      }
      content.status_id = status._id;
    }

    if (req.body?.platform_id !== undefined) {
      const platform = await loadPlatform(orgId, req.body.platform_id);
      const firstStatus = await ContentPlatformStatus.findOne({
        organization_id: orgId,
        platform_id: platform._id,
      }).sort({ sort_order: 1 });
      if (!firstStatus) {
        return res.status(400).json({ message: "Target platform has no statuses", success: false });
      }
      content.platform_id = platform._id;
      if (!req.body?.status_id) content.status_id = firstStatus._id;
    }

    await content.save();
    return res.status(200).json({
      success: true,
      message: "Content updated",
      content: serializeContent(content),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentDelete = async (req, res) => {
  const { orgId, contentId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    await loadContent(orgId, contentId);
    await ContentAnalytics.deleteMany({ organization_id: orgId, content_id: contentId });
    await ContentItem.deleteOne({ _id: contentId, organization_id: orgId });
    return res.status(200).json({ success: true, message: "Content deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

/** Clone content to another platform (repurpose across channels). */
export const contentRepurpose = async (req, res) => {
  const { orgId, contentId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const source = await loadContent(orgId, contentId);
    const targetPlatformId = req.body?.target_platform_id;
    if (!targetPlatformId) {
      return res.status(400).json({ message: "target_platform_id is required", success: false });
    }

    const platform = await loadPlatform(orgId, targetPlatformId);
    const firstStatus = await ContentPlatformStatus.findOne({
      organization_id: orgId,
      platform_id: platform._id,
    }).sort({ sort_order: 1 });
    if (!firstStatus) {
      return res.status(400).json({ message: "Target platform has no statuses", success: false });
    }

    const title = String(req.body?.title || `${source.title} (${platform.name})`).trim();
    const count = await ContentItem.countDocuments({
      organization_id: orgId,
      platform_id: platform._id,
      status_id: firstStatus._id,
    });

    const clone = await ContentItem.create({
      organization_id: orgId,
      platform_id: platform._id,
      status_id: firstStatus._id,
      pillar_id: null,
      title,
      description: source.description,
      hook: source.hook,
      script_body: source.script_body,
      notes: source.notes ? `Repurposed from: ${source.title}\n\n${source.notes}` : `Repurposed from: ${source.title}`,
      content_format: source.content_format,
      priority: source.priority,
      tags: [...(source.tags || [])],
      hashtags: [...(source.hashtags || [])],
      cta: source.cta,
      series_name: source.series_name,
      media_url: source.media_url,
      published_url: "",
      repurpose_of: source._id,
      checklist: (source.checklist || []).map((c) => ({
        label: c.label,
        done: false,
      })),
      scheduled_at: null,
      published_at: null,
      sort_order: count,
      created_by: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: `Repurposed to ${platform.name}`,
      content: serializeContent(clone),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentAnalyticsList = async (req, res) => {
  const { orgId, contentId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    await loadContent(orgId, contentId);
    const snapshots = await ContentAnalytics.find({
      organization_id: orgId,
      content_id: contentId,
    }).sort({ recorded_at: -1 });
    return res.status(200).json({ success: true, snapshots });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentAnalyticsCreate = async (req, res) => {
  const { orgId, contentId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const content = await loadContent(orgId, contentId);

    const num = (v) => Math.max(0, Number(v) || 0);
    const recorded_at = parseDate(req.body?.recorded_at) || new Date();

    const snapshot = await ContentAnalytics.create({
      organization_id: orgId,
      content_id: contentId,
      platform_id: content.platform_id,
      recorded_at,
      views: num(req.body?.views),
      likes: num(req.body?.likes),
      comments: num(req.body?.comments),
      shares: num(req.body?.shares),
      clicks: num(req.body?.clicks),
      watch_time_minutes: num(req.body?.watch_time_minutes),
      subscribers_gained: num(req.body?.subscribers_gained),
      custom_metrics: Array.isArray(req.body?.custom_metrics)
        ? req.body.custom_metrics
            .filter((m) => m && m.label)
            .map((m) => ({ label: String(m.label).trim(), value: num(m.value) }))
        : [],
      notes: String(req.body?.notes || "").trim(),
      recorded_by: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Analytics snapshot saved",
      snapshot,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const contentAnalyticsDelete = async (req, res) => {
  const { orgId, analyticsId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const deleted = await ContentAnalytics.findOneAndDelete({
      _id: analyticsId,
      organization_id: orgId,
    });
    if (!deleted) {
      return res.status(404).json({ message: "Analytics snapshot not found", success: false });
    }
    return res.status(200).json({ success: true, message: "Analytics snapshot deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

/* -------------------- Pillars -------------------- */

export const pillarList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const filter = { organization_id: orgId };
    if (req.query?.platform_id) filter.platform_id = req.query.platform_id;
    const pillars = await ContentPillar.find(filter).sort({ sort_order: 1, name: 1 });
    return res.status(200).json({ success: true, pillars });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const platformId = req.body?.platform_id;
    const name = String(req.body?.name || "").trim();
    if (!platformId || !name) {
      return res.status(400).json({ message: "platform_id and name are required", success: false });
    }
    await loadPlatform(orgId, platformId);
    const dup = await ContentPillar.findOne({ organization_id: orgId, platform_id: platformId, name });
    if (dup) {
      return res.status(409).json({ message: "Pillar already exists on this platform", success: false });
    }
    const count = await ContentPillar.countDocuments({ organization_id: orgId, platform_id: platformId });
    const pillar = await ContentPillar.create({
      organization_id: orgId,
      platform_id: platformId,
      name,
      description: String(req.body?.description || "").trim(),
      color: String(req.body?.color || "#22d3ee").trim(),
      target_share: Math.min(100, Math.max(0, Number(req.body?.target_share) || 25)),
      sort_order: req.body?.sort_order ?? count,
    });
    return res.status(201).json({ success: true, message: "Pillar created", pillar });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarUpdate = async (req, res) => {
  const { orgId, pillarId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const pillar = await ContentPillar.findOne({ _id: pillarId, organization_id: orgId });
    if (!pillar) return res.status(404).json({ message: "Pillar not found", success: false });
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: "Name is required", success: false });
      const dup = await ContentPillar.findOne({
        organization_id: orgId,
        platform_id: pillar.platform_id,
        name,
        _id: { $ne: pillarId },
      });
      if (dup) return res.status(409).json({ message: "Pillar name already in use", success: false });
      pillar.name = name;
    }
    if (req.body?.description !== undefined) pillar.description = String(req.body.description).trim();
    if (req.body?.color !== undefined) pillar.color = String(req.body.color).trim();
    if (req.body?.target_share !== undefined)
      pillar.target_share = Math.min(100, Math.max(0, Number(req.body.target_share) || 0));
    if (req.body?.sort_order !== undefined) pillar.sort_order = Number(req.body.sort_order) || 0;
    await pillar.save();
    return res.status(200).json({ success: true, message: "Pillar updated", pillar });
  } catch (error) {
    return handleError(res, error);
  }
};

export const pillarDelete = async (req, res) => {
  const { orgId, pillarId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const pillar = await ContentPillar.findOne({ _id: pillarId, organization_id: orgId });
    if (!pillar) return res.status(404).json({ message: "Pillar not found", success: false });
    await ContentItem.updateMany(
      { organization_id: orgId, pillar_id: pillarId },
      { $set: { pillar_id: null } }
    );
    await ContentPillar.deleteOne({ _id: pillarId, organization_id: orgId });
    return res.status(200).json({ success: true, message: "Pillar deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

/* -------------------- Templates -------------------- */

export const templateList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const filter = { organization_id: orgId };
    if (req.query?.platform_id) filter.platform_id = req.query.platform_id;
    const templates = await ContentTemplate.find(filter).sort({ sort_order: 1, name: 1 });
    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return handleError(res, error);
  }
};

export const templateCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "Name is required", success: false });
    const dup = await ContentTemplate.findOne({ organization_id: orgId, name });
    if (dup) return res.status(409).json({ message: "Template already exists", success: false });
    if (req.body?.platform_id) await loadPlatform(orgId, req.body.platform_id);
    const priority = req.body?.priority ? normalizeContentPriority(req.body.priority) : "medium";
    if (req.body?.priority && !isValidContentPriority(req.body.priority)) {
      return res.status(400).json({ message: "Invalid priority", success: false });
    }
    const count = await ContentTemplate.countDocuments({ organization_id: orgId });
    const template = await ContentTemplate.create({
      organization_id: orgId,
      platform_id: req.body?.platform_id || null,
      name,
      description: String(req.body?.description || "").trim(),
      title_template: String(req.body?.title_template || "").trim(),
      body_template: String(req.body?.body_template || "").trim(),
      default_tags: Array.isArray(req.body?.default_tags)
        ? req.body.default_tags.map((t) => String(t).trim()).filter(Boolean)
        : [],
      priority,
      sort_order: req.body?.sort_order ?? count,
    });
    return res.status(201).json({ success: true, message: "Template created", template });
  } catch (error) {
    return handleError(res, error);
  }
};

export const templateUpdate = async (req, res) => {
  const { orgId, templateId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const template = await ContentTemplate.findOne({ _id: templateId, organization_id: orgId });
    if (!template) return res.status(404).json({ message: "Template not found", success: false });
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: "Name is required", success: false });
      const dup = await ContentTemplate.findOne({
        organization_id: orgId,
        name,
        _id: { $ne: templateId },
      });
      if (dup) return res.status(409).json({ message: "Template name already in use", success: false });
      template.name = name;
    }
    ["description", "title_template", "body_template"].forEach((k) => {
      if (req.body?.[k] !== undefined) template[k] = String(req.body[k]).trim();
    });
    if (req.body?.default_tags !== undefined) {
      template.default_tags = Array.isArray(req.body.default_tags)
        ? req.body.default_tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
    }
    if (req.body?.priority !== undefined) {
      if (!isValidContentPriority(req.body.priority)) {
        return res.status(400).json({ message: "Invalid priority", success: false });
      }
      template.priority = normalizeContentPriority(req.body.priority);
    }
    if (req.body?.platform_id !== undefined) {
      template.platform_id = req.body.platform_id || null;
    }
    if (req.body?.sort_order !== undefined) template.sort_order = Number(req.body.sort_order) || 0;
    await template.save();
    return res.status(200).json({ success: true, message: "Template updated", template });
  } catch (error) {
    return handleError(res, error);
  }
};

export const templateDelete = async (req, res) => {
  const { orgId, templateId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const template = await ContentTemplate.findOne({ _id: templateId, organization_id: orgId });
    if (!template) return res.status(404).json({ message: "Template not found", success: false });
    await ContentTemplate.deleteOne({ _id: templateId, organization_id: orgId });
    return res.status(200).json({ success: true, message: "Template deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

/* -------------------- Goals -------------------- */

export const goalList = async (req, res) => {
  const { orgId } = req.params;
  try {
    await getOrgForMember(orgId, req.user._id);
    const filter = { organization_id: orgId };
    if (req.query?.include_archived !== "true") filter.is_archived = false;
    if (req.query?.platform_id) filter.platform_id = req.query.platform_id;
    const goals = await ContentGoal.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, goals });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalCreate = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const title = String(req.body?.title || "").trim();
    const target = Number(req.body?.target_value);
    if (!title || !Number.isFinite(target) || target <= 0) {
      return res
        .status(400)
        .json({ message: "title and a positive target_value are required", success: false });
    }
    if (req.body?.platform_id) await loadPlatform(orgId, req.body.platform_id);
    const goal = await ContentGoal.create({
      organization_id: orgId,
      platform_id: req.body?.platform_id || null,
      metric: String(req.body?.metric || "followers"),
      title,
      description: String(req.body?.description || "").trim(),
      start_value: Math.max(0, Number(req.body?.start_value) || 0),
      target_value: target,
      target_date: parseDate(req.body?.target_date) || null,
    });
    return res.status(201).json({ success: true, message: "Goal created", goal });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalUpdate = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await ContentGoal.findOne({ _id: goalId, organization_id: orgId });
    if (!goal) return res.status(404).json({ message: "Goal not found", success: false });
    ["title", "description", "metric"].forEach((k) => {
      if (req.body?.[k] !== undefined) goal[k] = String(req.body[k]).trim();
    });
    if (req.body?.start_value !== undefined) goal.start_value = Math.max(0, Number(req.body.start_value) || 0);
    if (req.body?.target_value !== undefined) {
      const t = Number(req.body.target_value);
      if (!Number.isFinite(t) || t <= 0)
        return res.status(400).json({ message: "target_value must be positive", success: false });
      goal.target_value = t;
    }
    if (req.body?.target_date !== undefined) goal.target_date = parseDate(req.body.target_date) || null;
    if (req.body?.platform_id !== undefined) goal.platform_id = req.body.platform_id || null;
    if (req.body?.is_archived !== undefined) goal.is_archived = Boolean(req.body.is_archived);
    if (req.body?.achieved_at !== undefined) goal.achieved_at = parseDate(req.body.achieved_at) || null;
    await goal.save();
    return res.status(200).json({ success: true, message: "Goal updated", goal });
  } catch (error) {
    return handleError(res, error);
  }
};

export const goalDelete = async (req, res) => {
  const { orgId, goalId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const goal = await ContentGoal.findOne({ _id: goalId, organization_id: orgId });
    if (!goal) return res.status(404).json({ message: "Goal not found", success: false });
    await ContentGoal.deleteOne({ _id: goalId, organization_id: orgId });
    return res.status(200).json({ success: true, message: "Goal deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

/* -------------------- Bulk content actions -------------------- */

export const contentBulkAction = async (req, res) => {
  const { orgId } = req.params;
  try {
    await assertCanWriteOrg(orgId, req.user._id);
    const action = String(req.body?.action || "").trim();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((i) => String(i)) : [];
    if (!action || !ids.length) {
      return res.status(400).json({ message: "action and ids are required", success: false });
    }
    const filter = { _id: { $in: ids }, organization_id: orgId };

    if (action === "delete") {
      await ContentAnalytics.deleteMany({ organization_id: orgId, content_id: { $in: ids } });
      const r = await ContentItem.deleteMany(filter);
      return res.status(200).json({ success: true, message: `${r.deletedCount} item(s) deleted` });
    }
    if (action === "move") {
      const statusId = req.body?.status_id;
      if (!statusId) return res.status(400).json({ message: "status_id is required", success: false });
      const status = await loadStatus(orgId, statusId);
      const r = await ContentItem.updateMany(
        { ...filter, platform_id: status.platform_id },
        { $set: { status_id: status._id } }
      );
      return res.status(200).json({ success: true, message: `${r.modifiedCount} item(s) moved` });
    }
    if (action === "priority") {
      const priority = normalizeContentPriority(req.body?.priority);
      const r = await ContentItem.updateMany(filter, { $set: { priority } });
      return res.status(200).json({ success: true, message: `${r.modifiedCount} item(s) updated` });
    }
    if (action === "pillar") {
      const pillarId = req.body?.pillar_id || null;
      if (pillarId) {
        const pillar = await ContentPillar.findOne({ _id: pillarId, organization_id: orgId });
        if (!pillar) return res.status(400).json({ message: "Pillar not found", success: false });
      }
      const r = await ContentItem.updateMany(filter, { $set: { pillar_id: pillarId } });
      return res.status(200).json({ success: true, message: `${r.modifiedCount} item(s) updated` });
    }
    if (action === "tag") {
      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
      const r = await ContentItem.updateMany(
        filter,
        tags.length ? { $addToSet: { tags: { $each: tags } } } : { $set: { tags: [] } }
      );
      return res.status(200).json({ success: true, message: `${r.modifiedCount} item(s) updated` });
    }
    return res.status(400).json({ message: "Unknown action", success: false });
  } catch (error) {
    return handleError(res, error);
  }
};
