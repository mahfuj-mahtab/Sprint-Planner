export const PARTITION_SCOPES = ["business", "owner", "excluded"];

export const DEFAULT_PARTITION_SCOPE = "business";

export const effectivePartitionScope = (partition) => {
  const scope = partition?.scope;
  if (scope && PARTITION_SCOPES.includes(scope)) return scope;
  return DEFAULT_PARTITION_SCOPE;
};

export const isBusinessScope = (partition) => effectivePartitionScope(partition) === "business";

export const isOwnerScope = (partition) => effectivePartitionScope(partition) === "owner";

export const isExcludedScope = (partition) => effectivePartitionScope(partition) === "excluded";

export const partitionScopeLabel = (scope) => {
  if (scope === "owner") return "Owner";
  if (scope === "excluded") return "Excluded";
  return "Business";
};
