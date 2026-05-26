export const FINANCE_CURRENCY_CODES = [
  "BDT",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "PKR",
  "CAD",
  "AUD",
  "SGD",
  "JPY",
  "CNY",
  "AED",
];

export const normalizeFinanceCurrency = (value, fallback = "BDT") => {
  const code = (value || fallback).trim().toUpperCase();
  if (FINANCE_CURRENCY_CODES.includes(code)) return code;
  if (/^[A-Z]{3}$/.test(code)) return code;
  return fallback;
};
