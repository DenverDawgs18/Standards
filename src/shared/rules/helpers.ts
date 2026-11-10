import type { Finding } from "../types";

export type Result = Omit<Finding, "ruleId" | "title" | "dataSheet" | "category" | "severity">;

/** Returns a "Needs info" result if any listed value is null/undefined, else null. */
export function needs(fields: Record<string, unknown>, location?: string): Result | null {
  const missing = Object.entries(fields)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  if (missing.length === 0) return null;
  return {
    status: "unknown",
    location,
    missing,
    message: `Not enough information to check: ${missing.join(", ")}.`,
    recommendation: "Add the missing values to the building model.",
  };
}

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const hr = (n: number) => `${fmt(n, 2)} hr`;
