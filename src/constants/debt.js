export const DEBT_DIRECTIONS = ["lent", "borrowed"];

export const DEFAULT_DEBT_DIRECTION = "lent";

export const parseDebtDirection = (value) => {
  const dir = String(value || DEFAULT_DEBT_DIRECTION).toLowerCase();
  return DEBT_DIRECTIONS.includes(dir) ? dir : DEFAULT_DEBT_DIRECTION;
};

export const isDebtLent = (debt) => parseDebtDirection(debt?.direction) === "lent";
