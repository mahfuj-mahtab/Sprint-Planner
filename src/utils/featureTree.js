import FeatureModule from "../models/featureModule.models.js";
import Feature from "../models/feature.models.js";
import Task from "../models/task.models.js";
import { isTaskDone } from "./taskWorkflow.js";

export const computeFeatureStatus = ({ totalTasks, completedTasks }) => {
  if (!totalTasks) return "pending";
  if (completedTasks >= totalTasks) return "completed";
  if (completedTasks > 0) return "in-progress";
  return "pending";
};

export const computeModuleStatus = (features) => {
  if (!features || features.length === 0) return "pending";
  const completed = features.filter((f) => f.status === "completed").length;
  if (completed === features.length) return "completed";
  if (completed > 0) return "in-progress";
  return "pending";
};

export const buildTaskCountsByFeature = (tasks) => {
  const taskCountsByFeature = new Map();
  for (const t of tasks) {
    const key = t.feature_id?.toString();
    if (!key) continue;
    const prev = taskCountsByFeature.get(key) || { totalTasks: 0, completedTasks: 0 };
    prev.totalTasks += 1;
    if (isTaskDone(t.status)) prev.completedTasks += 1;
    taskCountsByFeature.set(key, prev);
  }
  return taskCountsByFeature;
};

const toFeatureView = (f, taskCountsByFeature) => {
  const counts = taskCountsByFeature.get(f._id.toString()) || { totalTasks: 0, completedTasks: 0 };
  return {
    _id: f._id,
    name: f.name,
    description: f.description || "",
    module_id: f.module_id,
    totalTasks: counts.totalTasks,
    completedTasks: counts.completedTasks,
    status: computeFeatureStatus(counts),
  };
};

const collectDescendantModuleIds = (parentId, childrenByParent) => {
  const ids = [];
  const queue = [parentId];
  while (queue.length) {
    const id = queue.shift();
    ids.push(id);
    for (const child of childrenByParent.get(id) || []) {
      queue.push(child._id.toString());
    }
  }
  return ids;
};

/**
 * Build module → subModule → features tree for API responses.
 * Legacy: features may still live on top-level modules with no sub-modules.
 */
export const buildFeatureTree = (allModules, features, taskCountsByFeature) => {
  const childrenByParent = new Map();
  for (const m of allModules) {
    const pid = m.parent_module_id?.toString() || "root";
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(m);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  const featuresByModule = new Map();
  for (const f of features) {
    const key = f.module_id.toString();
    const view = toFeatureView(f, taskCountsByFeature);
    const arr = featuresByModule.get(key) || [];
    arr.push(view);
    featuresByModule.set(key, arr);
  }

  const buildSubModule = (mod) => {
    const directFeatures = featuresByModule.get(mod._id.toString()) || [];
    const childMods = childrenByParent.get(mod._id.toString()) || [];
    const subModules = childMods.map(buildSubModule);
    const nestedFeatures = subModules.flatMap((sm) => sm.features || []);
    const allFeatures = [...directFeatures, ...nestedFeatures];

    return {
      _id: mod._id,
      name: mod.name,
      parent_module_id: mod.parent_module_id || null,
      features: directFeatures,
      subModules: subModules.length ? subModules : undefined,
      totalFeatures: allFeatures.length,
      completedFeatures: allFeatures.filter((f) => f.status === "completed").length,
      status: computeModuleStatus(allFeatures),
    };
  };

  const topModules = childrenByParent.get("root") || [];
  return topModules.map(buildSubModule);
};

/** Flat list of leaf modules (where features can attach). */
export const getLeafModules = (allModules) => {
  const parentIds = new Set(
    allModules.filter((m) => m.parent_module_id).map((m) => m.parent_module_id.toString())
  );
  return allModules.filter((m) => !parentIds.has(m._id.toString()));
};

export const migrateParentFeaturesToSubModule = async (
  orgId,
  projectId,
  parentModuleId,
  subModuleId
) => {
  const siblingCount = await FeatureModule.countDocuments({
    organization_id: orgId,
    project_id: projectId,
    parent_module_id: parentModuleId,
  });
  if (siblingCount !== 1) return 0;

  const result = await Feature.updateMany(
    { organization_id: orgId, project_id: projectId, module_id: parentModuleId },
    { $set: { module_id: subModuleId } }
  );
  return result.modifiedCount || 0;
};

/** Move features still on a parent module into its oldest sub-module (legacy data fix). */
export const repairOrphanParentFeatures = async (orgId, projectId, allModules, features) => {
  let repaired = false;
  const topModules = allModules.filter((m) => !m.parent_module_id);

  for (const top of topModules) {
    const hasOrphans = features.some((f) => f.module_id.toString() === top._id.toString());
    if (!hasOrphans) continue;

    const children = allModules
      .filter((m) => m.parent_module_id?.toString() === top._id.toString())
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (!children.length) continue;

    await Feature.updateMany(
      { organization_id: orgId, project_id: projectId, module_id: top._id },
      { $set: { module_id: children[0]._id } }
    );
    repaired = true;
  }

  return repaired;
};

export const assertFeatureTargetIsLeaf = async (orgId, projectId, moduleId) => {
  const child = await FeatureModule.findOne({
    organization_id: orgId,
    project_id: projectId,
    parent_module_id: moduleId,
  }).select("_id");
  if (child) {
    const err = new Error("Add features to a sub-module, not a parent module");
    err.status = 400;
    throw err;
  }
};

export const deleteModuleCascade = async (orgId, projectId, moduleId) => {
  const allModules = await FeatureModule.find({ organization_id: orgId, project_id: projectId }).lean();
  const childrenByParent = new Map();
  for (const m of allModules) {
    const pid = m.parent_module_id?.toString() || "root";
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(m);
  }

  const toDelete = collectDescendantModuleIds(moduleId.toString(), childrenByParent);
  const features = await Feature.find({
    organization_id: orgId,
    project_id: projectId,
    module_id: { $in: toDelete },
  }).select("_id");
  const featureIds = features.map((f) => f._id);

  await Promise.all([
    Task.updateMany(
      { organization_id: orgId, project_id: projectId, feature_id: { $in: featureIds } },
      { $set: { feature_id: null } }
    ),
    Feature.deleteMany({ organization_id: orgId, project_id: projectId, module_id: { $in: toDelete } }),
    FeatureModule.deleteMany({ organization_id: orgId, project_id: projectId, _id: { $in: toDelete } }),
  ]);
};
