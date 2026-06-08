import FeatureModule from "../models/featureModule.models.js";

/** Drop legacy unique index (org + project + name only) so sub-modules can share names across parents. */
export async function ensureFeatureModuleIndexes() {
  const collection = FeatureModule.collection;

  try {
    const indexes = await collection.indexes();
    for (const idx of indexes) {
      const k = idx.key || {};
      const isLegacyUnique =
        idx.unique &&
        k.organization_id === 1 &&
        k.project_id === 1 &&
        k.name === 1 &&
        k.parent_module_id === undefined;

      if (isLegacyUnique) {
        console.log(`[FeatureModule] Dropping stale index: ${idx.name}`);
        await collection.dropIndex(idx.name);
      }
    }
  } catch (error) {
    if (error.code !== 27) {
      console.warn("[FeatureModule] Index cleanup:", error.message);
    }
  }

  await FeatureModule.syncIndexes();
}

export async function findOrCreateFeatureModule(orgId, projectId, name, parentModuleId = null) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    const err = new Error("Module name is required");
    err.status = 400;
    throw err;
  }

  const parent_module_id = parentModuleId || null;
  const filter = {
    organization_id: orgId,
    project_id: projectId,
    name: trimmed,
    parent_module_id,
  };

  let mod = await FeatureModule.findOne(filter);
  if (mod) return mod;

  try {
    mod = new FeatureModule(filter);
    await mod.save();
    return mod;
  } catch (error) {
    if (error?.code !== 11000) throw error;

    await ensureFeatureModuleIndexes().catch(() => {});
    mod = await FeatureModule.findOne(filter);
    if (mod) return mod;

    try {
      mod = new FeatureModule(filter);
      await mod.save();
      return mod;
    } catch (retryError) {
      if (retryError?.code === 11000) {
        mod = await FeatureModule.findOne(filter);
        if (mod) return mod;
      }
      throw retryError;
    }
  }
}
