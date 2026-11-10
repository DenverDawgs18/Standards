import type { DataSheetId } from "./criteria";
import type { BuildingModel } from "./model";

export type Status = "pass" | "fail" | "warning" | "unknown";
export type Severity = "critical" | "high" | "medium" | "low";
export type Category =
  | "Sprinkler protection"
  | "Water supply"
  | "Storage"
  | "Construction"
  | "Fire subdivision"
  | "Natural hazards"
  | "Monitoring & maintenance"
  | "Special hazards";

export interface Finding {
  ruleId: string;
  title: string;
  dataSheet: DataSheetId;
  category: Category;
  severity: Severity;
  status: Status;
  /** Where in the building this applies (area, wall, transformer), if not building-wide. */
  location?: string;
  message: string;
  required?: string;
  actual?: string;
  recommendation?: string;
  /** Model fields that were missing, for "Needs info" results. */
  missing?: string[];
}

export interface Rule {
  id: string;
  title: string;
  dataSheet: DataSheetId;
  category: Category;
  severity: Severity;
  run(model: BuildingModel): Omit<Finding, "ruleId" | "title" | "dataSheet" | "category" | "severity">[];
}

export interface Report {
  buildingName: string;
  generatedAt: string;
  verdict: "compliant" | "non-compliant" | "incomplete";
  score: number;
  counts: Record<Status, number>;
  findings: Finding[];
}
