import { z } from "zod";

/**
 * The building model every importer (JSON, IFC, blueprint extraction) produces
 * and the rules engine consumes.
 *
 * Units are US customary (ft, ft², gpm, psi, psf, mph, °F, gal) because the
 * FM data sheets publish US values first. A `null` means "not known yet": the
 * engine reports such checks as "Needs info" instead of guessing.
 */

const num = z.number().nullable();
const bool = z.boolean().nullable();

export const HazardCategory = z.enum(["HC-1", "HC-2", "HC-3"]);
export type HazardCategory = z.infer<typeof HazardCategory>;

export const Occupancy = z.enum([
  "office",
  "manufacturing",
  "warehouse",
  "data-center",
  "laboratory",
  "ignitable-liquid-storage",
  "electrical-room",
  "other",
]);
export type Occupancy = z.infer<typeof Occupancy>;

export const Sprinkler = z.object({
  systemType: z.enum(["wet", "dry", "preaction"]).nullable(),
  sprinklerType: z.enum(["standard-spray", "esfr", "control-mode-storage"]).nullable(),
  kFactor: num,
  temperatureRating_F: num,
  maxSpacing_ft: num.describe("Largest distance between adjacent sprinklers on a branch line or between lines"),
  minSpacing_ft: num.describe("Smallest distance between adjacent sprinklers"),
  maxCoveragePerSprinkler_ft2: num,
  designDensity_gpm_ft2: num,
  designArea_ft2: num,
  deflectorToTopOfStorage_ft: num.describe("Vertical clearance between sprinkler deflectors and the top of storage"),
});
export type Sprinkler = z.infer<typeof Sprinkler>;

export const Storage = z.object({
  arrangement: z.enum(["none", "rack", "solid-pile", "palletized", "shelf"]).nullable(),
  height_ft: num,
  commodity: z
    .enum([
      "class-1-3",
      "class-4",
      "cartoned-unexpanded-plastic",
      "cartoned-expanded-plastic",
      "uncartoned-plastic",
    ])
    .nullable(),
  inRackSprinklers: bool,
});
export type Storage = z.infer<typeof Storage>;

export const IgnitableLiquids = z.object({
  quantity_gal: num,
  cutoffRoom: bool,
  cutoffRating_hr: num,
  spillContainment: bool,
});

export const Area = z.object({
  id: z.string(),
  name: z.string(),
  occupancy: Occupancy.nullable(),
  hazardCategory: HazardCategory.nullable(),
  floorArea_ft2: num,
  ceilingHeight_ft: num,
  sprinklered: bool,
  sprinkler: Sprinkler.nullable(),
  storage: Storage.nullable(),
  ignitableLiquids: IgnitableLiquids.nullable(),
  smokeDetection: bool,
});
export type Area = z.infer<typeof Area>;

export const Opening = z.object({
  id: z.string(),
  type: z.enum(["door", "duct", "penetration", "window"]),
  rating_hr: num,
});

export const FireWall = z.object({
  id: z.string(),
  name: z.string(),
  rating_hr: num,
  separates: z.array(z.string()).describe("Area ids on either side"),
  openings: z.array(Opening),
});
export type FireWall = z.infer<typeof FireWall>;

export const Transformer = z.object({
  id: z.string(),
  name: z.string(),
  fluid: z.enum(["mineral-oil", "less-flammable", "dry-type"]).nullable(),
  volume_gal: num,
  distanceToBuilding_ft: num,
  adjacentWall: z.enum(["2-hr-fire-rated", "noncombustible", "combustible"]).nullable(),
});
export type Transformer = z.infer<typeof Transformer>;

export const BuildingModel = z.object({
  name: z.string(),
  site: z.object({
    designWindSpeed_mph: num.describe("3-second gust basic wind speed for the site"),
    windExposure: z.enum(["B", "C", "D"]).nullable(),
    groundSnowLoad_psf: num,
    hailZone: z.enum(["none", "moderate", "severe"]).nullable(),
    earthquakeZone: z.enum(["none", "500-yr", "250-yr", "100-yr", "50-yr"]).nullable(),
    floodZone: z.enum(["none", "500-yr", "100-yr"]).nullable(),
    designFloodElevation_ft: num,
  }),
  construction: z.object({
    stories: num,
    roofHeight_ft: num,
    exteriorWalls: z.object({
      material: z.enum(["concrete", "masonry", "metal-panel", "insulated-metal-panel", "wood-frame", "eifs", "other"]).nullable(),
      combustibleInsulation: bool,
      fmApproved: bool.describe("Wall assembly is FM Approved (Class 1)"),
    }),
    roof: z.object({
      deckType: z.enum(["steel", "concrete", "wood", "other"]).nullable(),
      fmApprovedAssembly: bool,
      windRatingClass: num.describe("FM Approvals wind uplift class, e.g. 90 for Class 1-90"),
      hailRating: z.enum(["SH", "MH", "none"]).nullable(),
      designSnowLoad_psf: num,
      combustibleInsulation: bool,
    }),
    concealedSpaces: z.object({
      combustible: bool,
      sprinklered: bool,
    }),
  }),
  areas: z.array(Area),
  fireWalls: z.array(FireWall),
  waterSupply: z.object({
    availableFlow_gpm: num.describe("Flow available at the residual pressure below"),
    residualPressure_psi: num,
    requiredSystemPressure_psi: num.describe("Hydraulically calculated pressure the most demanding system needs"),
    duration_min: num,
    firePumpPresent: bool,
    firePumpFmApproved: bool,
  }),
  systems: z.object({
    controlValvesSupervised: bool,
    waterflowAlarm: bool,
    centralStationMonitoring: bool,
    sprinklerSeismicBracing: bool,
    flexibleCouplings: bool,
    smokeVentsPresent: bool,
    smokeVentsAutomatic: bool,
    smokeVentOperatingTemp_F: num,
    extinguisherMaxTravel_ft: num,
  }),
  criticalEquipment: z.object({
    lowestElevation_ft: num.describe("Elevation of the lowest critical equipment (switchgear, pumps, generators)"),
  }),
  transformers: z.array(Transformer),
});
export type BuildingModel = z.infer<typeof BuildingModel>;

/** An empty model with every value unknown — the starting point for importers. */
export function emptyModel(name = "Untitled building"): BuildingModel {
  return {
    name,
    site: {
      designWindSpeed_mph: null,
      windExposure: null,
      groundSnowLoad_psf: null,
      hailZone: null,
      earthquakeZone: null,
      floodZone: null,
      designFloodElevation_ft: null,
    },
    construction: {
      stories: null,
      roofHeight_ft: null,
      exteriorWalls: { material: null, combustibleInsulation: null, fmApproved: null },
      roof: {
        deckType: null,
        fmApprovedAssembly: null,
        windRatingClass: null,
        hailRating: null,
        designSnowLoad_psf: null,
        combustibleInsulation: null,
      },
      concealedSpaces: { combustible: null, sprinklered: null },
    },
    areas: [],
    fireWalls: [],
    waterSupply: {
      availableFlow_gpm: null,
      residualPressure_psi: null,
      requiredSystemPressure_psi: null,
      duration_min: null,
      firePumpPresent: null,
      firePumpFmApproved: null,
    },
    systems: {
      controlValvesSupervised: null,
      waterflowAlarm: null,
      centralStationMonitoring: null,
      sprinklerSeismicBracing: null,
      flexibleCouplings: null,
      smokeVentsPresent: null,
      smokeVentsAutomatic: null,
      smokeVentOperatingTemp_F: null,
      extinguisherMaxTravel_ft: null,
    },
    criticalEquipment: { lowestElevation_ft: null },
    transformers: [],
  };
}

export function emptyArea(id: string, name: string): Area {
  return {
    id,
    name,
    occupancy: null,
    hazardCategory: null,
    floorArea_ft2: null,
    ceilingHeight_ft: null,
    sprinklered: null,
    sprinkler: null,
    storage: null,
    ignitableLiquids: null,
    smokeDetection: null,
  };
}

/**
 * Parse loosely-shaped JSON into a full model: missing keys become null so a
 * hand-written file only needs the facts it knows.
 */
export function normalizeModel(input: unknown): { model: BuildingModel; issues: string[] } {
  const base = emptyModel();
  const merged = deepMerge(base, input) as BuildingModel;
  if (Array.isArray(merged.areas)) {
    merged.areas = merged.areas.map((a, i) =>
      deepMerge(emptyArea(String((a as Area)?.id ?? `area-${i + 1}`), String((a as Area)?.name ?? `Area ${i + 1}`)), a) as Area,
    );
    for (const a of merged.areas) {
      if (a.sprinkler) a.sprinkler = deepMerge(emptySprinkler(), a.sprinkler) as Sprinkler;
      if (a.storage) a.storage = deepMerge({ arrangement: null, height_ft: null, commodity: null, inRackSprinklers: null }, a.storage) as Storage;
      if (a.ignitableLiquids)
        a.ignitableLiquids = deepMerge(
          { quantity_gal: null, cutoffRoom: null, cutoffRating_hr: null, spillContainment: null },
          a.ignitableLiquids,
        ) as Area["ignitableLiquids"];
    }
  }
  if (Array.isArray(merged.fireWalls)) {
    merged.fireWalls = merged.fireWalls.map((w, i) => ({
      id: w?.id ?? `fw-${i + 1}`,
      name: w?.name ?? `Fire wall ${i + 1}`,
      rating_hr: w?.rating_hr ?? null,
      separates: Array.isArray(w?.separates) ? w.separates : [],
      openings: Array.isArray(w?.openings)
        ? w.openings.map((o, j) => ({ id: o?.id ?? `${w?.id ?? i}-op-${j + 1}`, type: o?.type ?? "door", rating_hr: o?.rating_hr ?? null }))
        : [],
    }));
  }
  if (Array.isArray(merged.transformers)) {
    merged.transformers = merged.transformers.map((t, i) => ({
      id: t?.id ?? `tx-${i + 1}`,
      name: t?.name ?? `Transformer ${i + 1}`,
      fluid: t?.fluid ?? null,
      volume_gal: t?.volume_gal ?? null,
      distanceToBuilding_ft: t?.distanceToBuilding_ft ?? null,
      adjacentWall: t?.adjacentWall ?? null,
    }));
  }
  const parsed = BuildingModel.safeParse(merged);
  if (parsed.success) return { model: parsed.data, issues: [] };
  return {
    model: merged,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

export function emptySprinkler(): Sprinkler {
  return {
    systemType: null,
    sprinklerType: null,
    kFactor: null,
    temperatureRating_F: null,
    maxSpacing_ft: null,
    minSpacing_ft: null,
    maxCoveragePerSprinkler_ft2: null,
    designDensity_gpm_ft2: null,
    designArea_ft2: null,
    deflectorToTopOfStorage_ft: null,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
    return out;
  }
  return over;
}
