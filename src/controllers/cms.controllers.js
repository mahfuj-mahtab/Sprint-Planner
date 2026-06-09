import ContentPlatform from "../models/contentPlatform.models.js";
import ContentPlatformStatus from "../models/contentPlatformStatus.models.js";
import ContentItem from "../models/contentItem.models.js";
import ContentAnalytics from "../models/contentAnalytics.models.js";
import { getOrgForMember, assertCanWriteOrg } from "../utils/orgAccess.js";
import {
  DEFAULT_PLATFORM_STATUSES,
  isValidContentPriority,
  normalizeContentPriority,
} from "../constants/cmsWorkflow.js";
import { buildCmsDashboard, latestAnalyticsByContent } from "../utils/cmsMetrics.js";

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
  return { ...obj, ...extras };
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

const seedDefaultStatuses = async (orgId, platformId) => {
  const docs = DEFAULT_PLATFORM_STATUSES.map((s, i) => ({
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

    const latestMap = latestAnalyticsByContent(analyticsDocs);
    const enrichedContent = contentItems.map((c) =>
      serializeContent(c, {
        latest_analytics: latestMap.get(c._id.toString()) || null,
        analytics_count: analyticsDocs.filter(
          (a) => a.content_id.toString() === c._id.toString()
        ).length,
      })
    );

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

    const enrichedPlatforms = platforms.map((p) => ({
      ...p.toObject(),
      statuses: statusesByPlatform[p._id.toString()] || [],
      content: contentByPlatform[p._id.toString()] || [],
    }));

    return res.status(200).json({
      success: true,
      platforms: enrichedPlatforms,
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

    const platforms = await ContentPlatform.find({ organization_id: orgId, is_active: true }).lean();
    const statuses = await ContentPlatformStatus.find({ organization_id: orgId }).lean();
    const contentItems = await ContentItem.find({ organization_id: orgId }).lean();
    const analyticsDocs = await ContentAnalytics.find({ organization_id: orgId }).lean();

    const dashboard = buildCmsDashboard({
      platforms,
      statuses,
      contentItems,
      analyticsDocs,
    });

    return res.status(200).json({ success: true, dashboard });
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
    const platform = await ContentPlatform.create({
      organization_id: orgId,
      name,
      description: String(req.body?.description || "").trim(),
      color: String(req.body?.color || "#a78bfa").trim(),
      sort_order: count,
      is_active: req.body?.is_active !== false,
    });

    const statuses = await seedDefaultStatuses(orgId, platform._id);

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
    if (req.body?.description !== undefined) platform.description = String(req.body.description).trim();
    if (req.body?.color !== undefined) platform.color = String(req.body.color).trim();
    if (req.body?.sort_order !== undefined) platform.sort_order = Number(req.body.sort_order) || 0;
    if (req.body?.is_active !== undefined) platform.is_active = Boolean(req.body.is_active);

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
      title,
      description: String(req.body?.description || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      priority,
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
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
      content.title = title;
    }
    if (req.body?.description !== undefined) content.description = String(req.body.description).trim();
    if (req.body?.notes !== undefined) content.notes = String(req.body.notes).trim();
    if (req.body?.priority !== undefined) {
      if (!isValidContentPriority(req.body.priority)) {
        return res.status(400).json({ message: "Invalid priority", success: false });
      }
      content.priority = normalizeContentPriority(req.body.priority);
    }
    if (req.body?.tags !== undefined) {
      content.tags = Array.isArray(req.body.tags)
        ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
    }
    if (req.body?.scheduled_at !== undefined) content.scheduled_at = parseDate(req.body.scheduled_at);
    if (req.body?.published_at !== undefined) content.published_at = parseDate(req.body.published_at);
    if (req.body?.sort_order !== undefined) content.sort_order = Number(req.body.sort_order) || 0;

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
