import Project from "../models/project.models.js";
import ProjectVersion from "../models/projectVersion.models.js";
import Feature from "../models/feature.models.js";
import ProjectDocPage from "../models/projectDocPage.models.js";
import ProjectDocRevision from "../models/projectDocRevision.models.js";
import { getOrgForMember } from "../utils/orgAccess.js";
import { canViewProject } from "../utils/projectAccess.js";
import { loadUserProjectTeamIds } from "../utils/teamAccess.js";
import { assertCanWriteProjectDelivery } from "../utils/teamAccess.js";
import {
  emptyDoc,
  overviewTemplate,
  markdownToDoc,
  slugify,
} from "../utils/projectDocContent.js";

const handleError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || "Request failed",
    success: false,
    error: status === 500 ? error : undefined,
  });
};

const assertProjectRead = async (orgId, projectId, userId) => {
  const { isOwner, access } = await getOrgForMember(orgId, userId);
  const project = await Project.findOne({ _id: projectId, organization_id: orgId });
  if (!project) {
    const err = new Error("Project not found");
    err.status = 404;
    throw err;
  }
  const teamProjectIds = await loadUserProjectTeamIds(orgId, userId);
  if (
    !canViewProject(project, userId, {
      isOrgOwner: isOwner,
      isOrgAdmin: access?.role === "admin",
      teamProjectIds,
    })
  ) {
    const err = new Error("You do not have access to this project");
    err.status = 403;
    throw err;
  }
  return { project, access };
};

const loadPage = async (orgId, projectId, pageId) => {
  const page = await ProjectDocPage.findOne({
    _id: pageId,
    organization_id: orgId,
    project_id: projectId,
  });
  if (!page) {
    const err = new Error("Document page not found");
    err.status = 404;
    throw err;
  }
  return page;
};

const uniqueSlug = async (orgId, projectId, base, excludeId = null) => {
  let slug = slugify(base);
  let n = 0;
  while (true) {
    const candidate = n ? `${slug}-${n}` : slug;
    const exists = await ProjectDocPage.findOne({
      organization_id: orgId,
      project_id: projectId,
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!exists) return candidate;
    n += 1;
  }
};

const recordRevision = async (page, userId, changeSummary = "") => {
  const revision_number = (page.revision_count || 0) + 1;
  await ProjectDocRevision.create({
    organization_id: page.organization_id,
    project_id: page.project_id,
    page_id: page._id,
    revision_number,
    title: page.title,
    content: page.content,
    change_summary: changeSummary,
    created_by: userId,
  });
  page.revision_count = revision_number;
  return revision_number;
};

const seedProjectDocs = async (project, userId) => {
  const orgId = project.organization_id;
  const projectId = project._id;
  const existing = await ProjectDocPage.countDocuments({
    organization_id: orgId,
    project_id: projectId,
  });
  if (existing > 0) return;

  const legacy = String(project.documentation || "").trim();
  const overviewContent = legacy ? markdownToDoc(legacy) : overviewTemplate();

  await ProjectDocPage.create({
    organization_id: orgId,
    project_id: projectId,
    title: "Project overview",
    slug: "overview",
    doc_type: "overview",
    content: overviewContent,
    sort_order: 0,
    revision_count: 1,
    created_by: userId,
    updated_by: userId,
  });

  const overview = await ProjectDocPage.findOne({
    organization_id: orgId,
    project_id: projectId,
    slug: "overview",
  });
  await ProjectDocRevision.create({
    organization_id: orgId,
    project_id: projectId,
    page_id: overview._id,
    revision_number: 1,
    title: overview.title,
    content: overview.content,
    change_summary: legacy ? "Imported from legacy markdown documentation" : "Initial template",
    created_by: userId,
  });

  const versions = await ProjectVersion.find({
    organization_id: orgId,
    project_id: projectId,
  }).sort({ start_date: 1 });

  for (let i = 0; i < versions.length; i += 1) {
    const v = versions[i];
    const title = `Release: ${v.name}`;
    const page = await ProjectDocPage.create({
      organization_id: orgId,
      project_id: projectId,
      title,
      slug: await uniqueSlug(orgId, projectId, `release-${v.name}`),
      doc_type: "version",
      version_id: v._id,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: v.name }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: v.description || "Document scope, deliverables, and release notes for this version.",
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Release notes" }],
          },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        ],
      },
      sort_order: 10 + i,
      revision_count: 1,
      created_by: userId,
      updated_by: userId,
    });
    await ProjectDocRevision.create({
      organization_id: orgId,
      project_id: projectId,
      page_id: page._id,
      revision_number: 1,
      title: page.title,
      content: page.content,
      change_summary: "Auto-created from project version",
      created_by: userId,
    });
  }

  if (legacy) {
    project.documentation = "";
    await project.save();
  }
};

const syncVersionPages = async (orgId, projectId, userId) => {
  const versions = await ProjectVersion.find({
    organization_id: orgId,
    project_id: projectId,
  }).sort({ start_date: 1 });

  let created = 0;
  for (let i = 0; i < versions.length; i += 1) {
    const v = versions[i];
    const exists = await ProjectDocPage.findOne({
      organization_id: orgId,
      project_id: projectId,
      version_id: v._id,
    });
    if (exists) continue;

    const page = await ProjectDocPage.create({
      organization_id: orgId,
      project_id: projectId,
      title: `Release: ${v.name}`,
      slug: await uniqueSlug(orgId, projectId, `release-${v.name}`),
      doc_type: "version",
      version_id: v._id,
      content: emptyDoc(),
      sort_order: 100 + i,
      revision_count: 1,
      created_by: userId,
      updated_by: userId,
    });
    await ProjectDocRevision.create({
      organization_id: orgId,
      project_id: projectId,
      page_id: page._id,
      revision_number: 1,
      title: page.title,
      content: page.content,
      change_summary: "Created from version sync",
      created_by: userId,
    });
    created += 1;
  }
  return created;
};

export const projectDocList = async (req, res) => {
  const { orgId, projectId } = req.params;
  try {
    const { project, access } = await assertProjectRead(orgId, projectId, req.user._id);
    await seedProjectDocs(project, req.user._id);

    let can_write = Boolean(access?.canWrite);
    try {
      await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);
    } catch {
      can_write = false;
    }

    const pages = await ProjectDocPage.find({
      organization_id: orgId,
      project_id: projectId,
    })
      .sort({ sort_order: 1, title: 1 })
      .lean();

    const versions = await ProjectVersion.find({
      organization_id: orgId,
      project_id: projectId,
    })
      .select("name description status start_date end_date is_locked")
      .sort({ start_date: 1 })
      .lean();

    const features = await Feature.find({ organization_id: orgId, project_id: projectId })
      .select("name description module_id")
      .lean();

    return res.status(200).json({
      success: true,
      pages,
      versions,
      features,
      can_write,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocPageGet = async (req, res) => {
  const { orgId, projectId, pageId } = req.params;
  try {
    await assertProjectRead(orgId, projectId, req.user._id);
    const page = await loadPage(orgId, projectId, pageId);
    const revisions = await ProjectDocRevision.find({
      organization_id: orgId,
      page_id: pageId,
    })
      .sort({ revision_number: -1 })
      .limit(25)
      .populate("created_by", "name email")
      .lean();

    return res.status(200).json({ success: true, page, revisions });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocPageCreate = async (req, res) => {
  const { orgId, projectId } = req.params;
  try {
    await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);

    let title = String(req.body?.title || "").trim();
    let doc_type = String(req.body?.doc_type || "custom").trim();
    let version_id = req.body?.version_id || null;
    let feature_id = req.body?.feature_id || null;
    let content = req.body?.content || emptyDoc();

    if (feature_id) {
      const feature = await Feature.findOne({
        _id: feature_id,
        organization_id: orgId,
        project_id: projectId,
      });
      if (!feature) {
        return res.status(400).json({ message: "Feature not found", success: false });
      }
      const dup = await ProjectDocPage.findOne({
        organization_id: orgId,
        project_id: projectId,
        feature_id,
      });
      if (dup) {
        return res.status(409).json({
          message: "A document already exists for this feature",
          success: false,
          page: dup,
        });
      }
      title = title || feature.name;
      doc_type = "feature";
      if (!req.body?.content) {
        content = {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: feature.name }] },
            {
              type: "paragraph",
              content: [{ type: "text", text: feature.description || "Describe this feature for your team." }],
            },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "User story" }] },
            { type: "paragraph" },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Acceptance criteria" }] },
            { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
          ],
        };
      }
    }

    if (version_id) {
      const version = await ProjectVersion.findOne({
        _id: version_id,
        organization_id: orgId,
        project_id: projectId,
      });
      if (!version) {
        return res.status(400).json({ message: "Version not found", success: false });
      }
      title = title || `Release: ${version.name}`;
      doc_type = "version";
    }

    if (!title) {
      return res.status(400).json({ message: "Title is required", success: false });
    }

    const slug = await uniqueSlug(orgId, projectId, req.body?.slug || title);
    const count = await ProjectDocPage.countDocuments({ organization_id: orgId, project_id: projectId });

    const page = await ProjectDocPage.create({
      organization_id: orgId,
      project_id: projectId,
      title,
      slug,
      doc_type,
      version_id: version_id || null,
      feature_id: feature_id || null,
      content,
      sort_order: req.body?.sort_order ?? count,
      revision_count: 1,
      created_by: req.user._id,
      updated_by: req.user._id,
    });

    await ProjectDocRevision.create({
      organization_id: orgId,
      project_id: projectId,
      page_id: page._id,
      revision_number: 1,
      title: page.title,
      content: page.content,
      change_summary: "Created",
      created_by: req.user._id,
    });

    return res.status(201).json({ success: true, message: "Page created", page });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocPageUpdate = async (req, res) => {
  const { orgId, projectId, pageId } = req.params;
  try {
    await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);
    const page = await loadPage(orgId, projectId, pageId);

    const changeSummary = String(req.body?.change_summary || "").trim();
    let changed = false;

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) {
        return res.status(400).json({ message: "Title is required", success: false });
      }
      if (title !== page.title) {
        page.title = title;
        changed = true;
        if (page.doc_type === "version" && page.version_id) {
          const versionName = title.replace(/^Release:\s*/i, "").trim() || title;
          await ProjectVersion.updateOne(
            { _id: page.version_id, organization_id: orgId, project_id: projectId },
            { $set: { name: versionName } }
          );
        }
      }
    }

    if (req.body?.content !== undefined) {
      const next = JSON.stringify(req.body.content);
      const prev = JSON.stringify(page.content);
      if (next !== prev) {
        page.content = req.body.content;
        changed = true;
      }
    }

    if (req.body?.sort_order !== undefined) {
      page.sort_order = Number(req.body.sort_order) || 0;
    }

    if (!changed) {
      return res.status(200).json({ success: true, message: "No changes", page });
    }

    page.updated_by = req.user._id;
    await recordRevision(page, req.user._id, changeSummary || "Updated");
    await page.save();

    return res.status(200).json({
      success: true,
      message: `Saved as revision ${page.revision_count}`,
      page,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocPageDelete = async (req, res) => {
  const { orgId, projectId, pageId } = req.params;
  try {
    await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);
    const page = await loadPage(orgId, projectId, pageId);
    if (page.doc_type === "overview") {
      return res.status(400).json({ message: "Cannot delete the project overview page", success: false });
    }
    await ProjectDocRevision.deleteMany({ organization_id: orgId, page_id: pageId });
    await ProjectDocPage.deleteOne({ _id: pageId, organization_id: orgId, project_id: projectId });
    return res.status(200).json({ success: true, message: "Page deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocSyncVersions = async (req, res) => {
  const { orgId, projectId } = req.params;
  try {
    await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);
    const created = await syncVersionPages(orgId, projectId, req.user._id);
    const pages = await ProjectDocPage.find({ organization_id: orgId, project_id: projectId })
      .sort({ sort_order: 1 })
      .lean();
    return res.status(200).json({
      success: true,
      message: created ? `Added ${created} version document(s)` : "All versions already have documents",
      created,
      pages,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const projectDocRevisionRestore = async (req, res) => {
  const { orgId, projectId, pageId, revisionId } = req.params;
  try {
    await assertCanWriteProjectDelivery(orgId, projectId, req.user._id);
    const page = await loadPage(orgId, projectId, pageId);
    const revision = await ProjectDocRevision.findOne({
      _id: revisionId,
      organization_id: orgId,
      page_id: pageId,
    });
    if (!revision) {
      return res.status(404).json({ message: "Revision not found", success: false });
    }

    page.title = revision.title;
    page.content = revision.content;
    page.updated_by = req.user._id;
    await recordRevision(page, req.user._id, `Restored revision ${revision.revision_number}`);
    await page.save();

    return res.status(200).json({
      success: true,
      message: `Restored revision ${revision.revision_number}`,
      page,
    });
  } catch (error) {
    return handleError(res, error);
  }
};
