/**
 * Numeric criteria the checks compare against, grouped by FM data sheet.
 *
 * IMPORTANT: FM Property Loss Prevention Data Sheets are revised often and are
 * published by FM (fm.com). These values are a simplified encoding of
 * published criteria and must be confirmed against the current edition of each
 * sheet before they are relied on for design or underwriting. Each block
 * records the edition it was taken from and whether it has been confirmed, and
 * the dashboard shows that status next to every finding.
 *
 * To update a value: edit it here, set `confirmed: true` and `edition` to the
 * edition you checked it against.
 */

export interface CriteriaSource {
  dataSheet: string;
  title: string;
  edition: string;
  confirmed: boolean;
  note?: string;
}

export const SOURCES = {
  "1-2": { dataSheet: "1-2", title: "Earthquakes", edition: "not confirmed", confirmed: false },
  "1-10": { dataSheet: "1-10", title: "Smoke and Heat Venting in Sprinklered Buildings", edition: "not confirmed", confirmed: false },
  "1-12": { dataSheet: "1-12", title: "Ceilings and Concealed Spaces", edition: "not confirmed", confirmed: false },
  "1-23": { dataSheet: "1-23", title: "Protection of Openings in Fire Subdivisions", edition: "not confirmed", confirmed: false },
  "1-28": { dataSheet: "1-28", title: "Wind Design", edition: "not confirmed", confirmed: false },
  "1-29": { dataSheet: "1-29", title: "Roof Deck Securement and Above-Deck Roof Components", edition: "not confirmed", confirmed: false },
  "1-34": { dataSheet: "1-34", title: "Hail Damage", edition: "not confirmed", confirmed: false },
  "1-40": { dataSheet: "1-40", title: "Flood", edition: "not confirmed", confirmed: false },
  "1-54": { dataSheet: "1-54", title: "Roof Loads and Drainage", edition: "not confirmed", confirmed: false },
  "1-57": { dataSheet: "1-57", title: "Plastics in Construction", edition: "not confirmed", confirmed: false },
  "2-0": { dataSheet: "2-0", title: "Installation Guidelines for Automatic Sprinklers", edition: "not confirmed", confirmed: false },
  "2-8": { dataSheet: "2-8", title: "Earthquake Protection for Water-Based Fire Protection Systems", edition: "not confirmed", confirmed: false },
  "2-81": { dataSheet: "2-81", title: "Fire Safety Inspections and Sprinkler System Maintenance", edition: "not confirmed", confirmed: false },
  "3-7": { dataSheet: "3-7", title: "Fire Protection Pumps", edition: "not confirmed", confirmed: false },
  "3-26": {
    dataSheet: "3-26",
    title: "Fire Protection for Nonstorage Occupancies",
    edition: "2019–2020 editions (hose allowance and duration)",
    confirmed: false,
    note: "Hose allowances (250/250/500 gpm) and 60-minute duration match published summaries of the 2019–2020 editions. Newer editions tabulate density by ceiling height and sprinkler type; ceilings above 30 ft need the full tables.",
  },
  "4-5": { dataSheet: "4-5", title: "Portable Extinguishers", edition: "not confirmed", confirmed: false },
  "5-4": {
    dataSheet: "5-4",
    title: "Transformers",
    edition: "2020 (volume tiers)",
    confirmed: false,
    note: "Mineral-oil volume tiers (<500 gal, 500–5,000 gal, >5,000 gal) match published summaries; distances by wall construction must be confirmed.",
  },
  "5-32": { dataSheet: "5-32", title: "Data Centers and Related Facilities", edition: "not confirmed", confirmed: false },
  "5-40": { dataSheet: "5-40", title: "Fire Alarm Systems", edition: "not confirmed", confirmed: false },
  "7-29": { dataSheet: "7-29", title: "Ignitable Liquid Storage in Portable Containers", edition: "not confirmed", confirmed: false },
  "8-9": { dataSheet: "8-9", title: "Storage of Class 1, 2, 3, 4 and Plastic Commodities", edition: "not confirmed", confirmed: false },
} satisfies Record<string, CriteriaSource>;

export type DataSheetId = keyof typeof SOURCES;

/** DS 3-26: ceiling sprinkler design and water demand for nonstorage occupancies (ceilings ≤ 30 ft). */
export const NONSTORAGE_DEMAND = {
  "HC-1": { density_gpm_ft2: 0.1, area_ft2: 1500, hose_gpm: 250, duration_min: 60 },
  "HC-2": { density_gpm_ft2: 0.2, area_ft2: 2500, hose_gpm: 250, duration_min: 60 },
  "HC-3": { density_gpm_ft2: 0.3, area_ft2: 2500, hose_gpm: 500, duration_min: 60 },
} as const;
/** Ceiling height above which DS 3-26's simple density/area values no longer apply. */
export const NONSTORAGE_MAX_SIMPLE_CEILING_FT = 30;
/** Dry-pipe and preaction systems: increase the design area. */
export const DRY_SYSTEM_AREA_FACTOR = 1.3;

/** DS 2-0: sprinkler spacing and coverage. */
export const SPACING = {
  "standard-spray": { minSpacing_ft: 6, maxSpacing_ft: 15, maxCoverage_ft2: { "HC-1": 225, "HC-2": 130, "HC-3": 100 } },
  "control-mode-storage": { minSpacing_ft: 8, maxSpacing_ft: 12, maxCoverage_ft2: { "HC-1": 100, "HC-2": 100, "HC-3": 100 } },
  esfr: { minSpacing_ft: 8, maxSpacing_ft: 12, maxSpacingHighCeiling_ft: 10, highCeiling_ft: 30, maxCoverage_ft2: { "HC-1": 100, "HC-2": 100, "HC-3": 100 } },
} as const;

/** DS 8-9 / 2-0: storage sprinkler limits. */
export const STORAGE = {
  esfrMaxCeiling_ft: 45,
  minDeflectorClearance_ft: 3,
  /** Storage above this height needs a DS 8-9 storage design rather than DS 3-26 nonstorage criteria. */
  nonstorageMaxHeight_ft: 5,
  /** Rack storage above this height with control-mode sprinklers typically needs in-rack sprinklers. */
  ceilingOnlyControlModeMaxRack_ft: 25,
};

/** DS 1-28: wind. */
export const WIND = {
  /** FM Approved roof ratings are tested at twice the design uplift pressure. */
  safetyFactor: 2,
  ratingClassStep: 15,
  minRatingClass: 60,
  kd: 0.85,
  gcpField: 1.0,
  gcpi: 0.18,
};

/** DS 1-54: flat-roof snow load, simplified. */
export const SNOW = { flatRoofFactor: 0.7, exposure: 1.0, thermal: 1.0, importance: 1.15, minimumRoofSnow_psf: 20 };

/** DS 1-40: freeboard above the design flood elevation for critical equipment. */
export const FLOOD = { freeboard_ft: 1 };

/** DS 1-23: minimum opening protection by fire wall rating (hours). */
export function requiredOpeningRating(wall_hr: number): number {
  if (wall_hr >= 3) return 3;
  if (wall_hr >= 2) return 1.5;
  return 0.75;
}

/** DS 5-4: minimum separation (ft) of outdoor liquid-insulated transformers from buildings. */
export function transformerSeparation(
  fluid: "mineral-oil" | "less-flammable",
  volume_gal: number,
  wall: "2-hr-fire-rated" | "noncombustible" | "combustible",
): number {
  const tier = volume_gal < 500 ? 0 : volume_gal <= 5000 ? 1 : 2;
  if (fluid === "less-flammable") {
    return [[3, 3, 5], [5, 5, 15], [25, 25, 50]][tier][wallIndex(wall)];
  }
  return [[5, 15, 25], [15, 25, 50], [25, 50, 100]][tier][wallIndex(wall)];
}
function wallIndex(w: "2-hr-fire-rated" | "noncombustible" | "combustible") {
  return w === "2-hr-fire-rated" ? 0 : w === "noncombustible" ? 1 : 2;
}

/** DS 7-29: ignitable liquids in portable containers. */
export const IGNITABLE = { cutoffThreshold_gal: 120, minCutoffRating_hr: 1 };

/** DS 4-5: maximum travel distance to a Class A extinguisher. */
export const EXTINGUISHER_MAX_TRAVEL_FT = 75;

/** Minimum hazard category FM practice usually assigns by occupancy (sanity check only). */
export const MIN_HAZARD_BY_OCCUPANCY: Partial<Record<string, "HC-1" | "HC-2" | "HC-3">> = {
  manufacturing: "HC-2",
  warehouse: "HC-2",
  "ignitable-liquid-storage": "HC-3",
};
