import FeatureModule from "../models/featureModule.models.js";
import Feature from "../models/feature.models.js";
import Task from "../models/task.models.js";

const normalizeName = (value) => String(value || "").trim();

const normalizeFeatureInput = (raw) => {
  if (typeof raw === "string") {
    const name = normalizeName(raw);
    return name ? { name, description: "" } : null;
  }
  if (raw && typeof raw === "object") {
    const name = normalizeName(raw.name);
    if (!name) return null;
    return {
      name,
      description: normalizeName(raw.description || raw.details || ""),
    };
  }
  return null;
};

const normalizeSubModuleInput = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const name = normalizeName(raw.name || raw.subModule || raw.sub_module);
  if (!name) return null;
  const features = (raw.features || []).map(normalizeFeatureInput).filter(Boolean);
  return { name, features };
};

const normalizeModuleInput = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const name = normalizeName(raw.name || raw.module);
  if (!name) return null;

  const subModules = (raw.subModules || raw.sub_modules || raw.children || [])
    .map(normalizeSubModuleInput)
    .filter(Boolean);

  const directFeatures = (raw.features || []).map(normalizeFeatureInput).filter(Boolean);

  return { name, subModules, directFeatures };
};

/** Build module tree from spreadsheet rows. */
export function parseFeatureImportRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error("Import rows must be a non-empty array");
    err.status = 400;
    throw err;
  }

  const normalized = rows.map((row) => {
    if (typeof row !== "object" || !row) return null;
    const module = normalizeName(row.module || row.Module);
    const sub_module = normalizeName(row.sub_module || row.subModule || row["sub module"] || row.sub);
    const feature = normalizeName(row.feature || row.Feature || row.name);
    const description = normalizeName(row.description || row.details || row.notes);
    if (!module || !feature) return null;
    return { module, sub_module, feature, description };
  }).filter(Boolean);

  if (!normalized.length) {
    const err = new Error("No valid rows — each row needs module and feature");
    err.status = 400;
    throw err;
  }

  const modules = new Map();
  for (const row of normalized) {
    const subName = row.sub_module || "General";
    if (!modules.has(row.module)) modules.set(row.module, new Map());
    const subs = modules.get(row.module);
    if (!subs.has(subName)) subs.set(subName, []);
    subs.get(subName).push({ name: row.feature, description: row.description || "" });
  }

  return Array.from(modules.entries()).map(([name, subs]) => ({
    name,
    subModules: Array.from(subs.entries()).map(([subName, features]) => ({ name: subName, features })),
    directFeatures: [],
  }));
}

/** Parse JSON modules or spreadsheet rows. */
export const parseFeatureImportPayload = (body) => {
  if (body?.rows?.length) {
    return parseFeatureImportRows(body.rows);
  }

  let raw = body;
  if (typeof body === "string") {
    raw = JSON.parse(body);
  }
  const list = Array.isArray(raw) ? raw : raw?.modules;
  if (!Array.isArray(list) || list.length === 0) {
    const err = new Error(
      "Import must be JSON modules, { modules: [...] }, or { rows: [{ module, sub_module, feature, description }] }"
    );
    err.status = 400;
    throw err;
  }
  const modules = list.map(normalizeModuleInput).filter(Boolean);
  if (!modules.length) {
    const err = new Error("No valid modules found in import");
    err.status = 400;
    throw err;
  }
  return modules;
};

async function findOrCreateModule(orgId, projectId, name, parentModuleId) {
  const filter = {
    organization_id: orgId,
    project_id: projectId,
    name,
    parent_module_id: parentModuleId || null,
  };
  let mod = await FeatureModule.findOne(filter);
  if (!mod) {
    mod = new FeatureModule(filter);
    await mod.save();
  }
  return mod;
}

async function findOrCreateFeature(orgId, projectId, moduleId, feat) {
  const filter = {
    organization_id: orgId,
    project_id: projectId,
    module_id: moduleId,
    name: feat.name,
  };
  let feature = await Feature.findOne(filter);
  if (!feature) {
    feature = new Feature({ ...filter, description: feat.description || "" });
    await feature.save();
  } else if (feat.description && feat.description !== feature.description) {
    feature.description = feat.description;
    await feature.save();
  }
  return feature;
}

export async function importFeatureTree(orgId, projectId, parsedModules, { mode = "merge" } = {}) {
  if (mode === "replace") {
    await Task.updateMany(
      { organization_id: orgId, project_id: projectId, feature_id: { $ne: null } },
      { $set: { feature_id: null } }
    );
    const mods = await FeatureModule.find({ organization_id: orgId, project_id: projectId }).select("_id");
    const modIds = mods.map((m) => m._id);
    await Feature.deleteMany({ organization_id: orgId, project_id: projectId });
    await FeatureModule.deleteMany({ _id: { $in: modIds } });
  }

  let modulesCreated = 0;
  let subModulesCreated = 0;
  let featuresCreated = 0;

  for (const modInput of parsedModules) {
    const beforeTop = await FeatureModule.countDocuments({
      organization_id: orgId,
      project_id: projectId,
      name: modInput.name,
      parent_module_id: null,
    });
    const top = await findOrCreateModule(orgId, projectId, modInput.name, null);
    if (!beforeTop) modulesCreated += 1;

    if (modInput.subModules.length) {
      for (const subInput of modInput.subModules) {
        const beforeSub = await FeatureModule.countDocuments({
          organization_id: orgId,
          project_id: projectId,
          name: subInput.name,
          parent_module_id: top._id,
        });
        const sub = await findOrCreateModule(orgId, projectId, subInput.name, top._id);
        if (!beforeSub) subModulesCreated += 1;

        for (const feat of subInput.features) {
          const beforeFeat = await Feature.countDocuments({
            organization_id: orgId,
            project_id: projectId,
            module_id: sub._id,
            name: feat.name,
          });
          await findOrCreateFeature(orgId, projectId, sub._id, feat);
          if (!beforeFeat) featuresCreated += 1;
        }
      }
    }

    if (modInput.directFeatures.length) {
      const subName = modInput.subModules.length ? "Other" : "General";
      const beforeSub = await FeatureModule.countDocuments({
        organization_id: orgId,
        project_id: projectId,
        name: subName,
        parent_module_id: top._id,
      });
      const sub = await findOrCreateModule(orgId, projectId, subName, top._id);
      if (!beforeSub) subModulesCreated += 1;

      for (const feat of modInput.directFeatures) {
        const beforeFeat = await Feature.countDocuments({
          organization_id: orgId,
          project_id: projectId,
          module_id: sub._id,
          name: feat.name,
        });
        await findOrCreateFeature(orgId, projectId, sub._id, feat);
        if (!beforeFeat) featuresCreated += 1;
      }
    }
  }

  return { modulesCreated, subModulesCreated, featuresCreated };
}

export const FEATURE_CSV_TEMPLATE = `module,sub_module,feature,description
User Management,Authentication,Email login,Sign in with email and password
User Management,Authentication,Password reset,Forgot password flow
User Management,Profile,Edit profile,
Billing,Payments,Stripe checkout,
`;

export const FEATURE_IMPORT_TEMPLATE = [
  {
    name: "User Management",
    subModules: [
      {
        name: "Authentication",
        features: [
          { name: "Email login", description: "Sign in with email and password" },
          { name: "Password reset", description: "Forgot password flow" },
        ],
      },
      {
        name: "Profile",
        features: [{ name: "Edit profile" }, { name: "Avatar upload" }],
      },
    ],
  },
  {
    name: "Billing",
    subModules: [
      {
        name: "Payments",
        features: [{ name: "Stripe checkout" }, { name: "Invoice history" }],
      },
    ],
  },
];
