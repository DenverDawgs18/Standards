import type { BuildingModel } from "./model";
import { constructionRules, monitoringRules, naturalHazardRules, specialHazardRules } from "./rules/building";
import { sprinklerRules } from "./rules/sprinklers";
import { storageRules, waterRules } from "./rules/storage-water";
import type { Finding, Report, Rule, Severity, Status } from "./types";

export const RULES: Rule[] = [
  ...sprinklerRules,
  ...storageRules,
  ...waterRules,
  ...constructionRules,
  ...naturalHazardRules,
  ...monitoringRules,
  ...specialHazardRules,
];

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 8, high: 4, medium: 2, low: 1 };
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const STATUS_ORDER: Status[] = ["fail", "warning", "unknown", "pass"];

export function evaluate(model: BuildingModel, rules: Rule[] = RULES): Report {
  const findings: Finding[] = [];
  for (const rule of rules) {
    let results;
    try {
      results = rule.run(model);
    } catch (err) {
      results = [{ status: "unknown" as const, message: `Check could not run: ${(err as Error).message}` }];
    }
    for (const r of results)
      findings.push({ ruleId: rule.id, title: rule.title, dataSheet: rule.dataSheet, category: rule.category, severity: rule.severity, ...r });
  }
  findings.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const counts: Record<Status, number> = { pass: 0, fail: 0, warning: 0, unknown: 0 };
  for (const f of findings) counts[f.status]++;

  // Score: weighted share of evaluated checks that pass (warnings count half).
  let earned = 0;
  let possible = 0;
  for (const f of findings) {
    if (f.status === "unknown") continue;
    const w = SEVERITY_WEIGHT[f.severity];
    possible += w;
    earned += f.status === "pass" ? w : f.status === "warning" ? w / 2 : 0;
  }
  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const verdict = counts.fail > 0 ? "non-compliant" : counts.unknown > 0 ? "incomplete" : "compliant";

  return { buildingName: model.name, generatedAt: new Date().toISOString(), verdict, score, counts, findings };
}
