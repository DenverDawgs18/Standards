import {
  DRY_SYSTEM_AREA_FACTOR,
  MIN_HAZARD_BY_OCCUPANCY,
  NONSTORAGE_DEMAND,
  NONSTORAGE_MAX_SIMPLE_CEILING_FT,
  SPACING,
  STORAGE,
} from "../criteria";
import type { Area } from "../model";
import type { Rule } from "../types";
import { fmt, needs, type Result } from "./helpers";

const isStorageArea = (a: Area) =>
  !!a.storage && a.storage.arrangement !== null && a.storage.arrangement !== "none" && (a.storage.height_ft ?? 0) > STORAGE.nonstorageMaxHeight_ft;

const HC_RANK = { "HC-1": 1, "HC-2": 2, "HC-3": 3 } as const;

export const sprinklerRules: Rule[] = [
  {
    id: "sprinklers-throughout",
    title: "Automatic sprinklers provided throughout",
    dataSheet: "3-26",
    category: "Sprinkler protection",
    severity: "critical",
    run(m) {
      if (m.areas.length === 0)
        return [{ status: "unknown", message: "The model has no areas.", missing: ["areas"], recommendation: "Add the building's areas/rooms." }];
      return m.areas.map((a): Result => {
        if (a.sprinklered === null) return needs({ sprinklered: null }, a.name)!;
        if (a.sprinklered) return { status: "pass", location: a.name, message: "Area is sprinklered." };
        return {
          status: "fail",
          location: a.name,
          message: "Area has no automatic sprinkler protection.",
          required: "Automatic sprinklers",
          actual: "None",
          recommendation: "Install automatic sprinklers designed to DS 3-26 (nonstorage) or DS 8-9 (storage) and installed per DS 2-0.",
        };
      });
    },
  },
  {
    id: "hazard-category-plausible",
    title: "Hazard category consistent with occupancy",
    dataSheet: "3-26",
    category: "Sprinkler protection",
    severity: "medium",
    run(m) {
      return m.areas.map((a): Result => {
        const n = needs({ occupancy: a.occupancy, hazardCategory: a.hazardCategory }, a.name);
        if (n) return n;
        const min = MIN_HAZARD_BY_OCCUPANCY[a.occupancy!];
        if (!min || HC_RANK[a.hazardCategory!] >= HC_RANK[min])
          return { status: "pass", location: a.name, message: `${a.hazardCategory} is plausible for ${a.occupancy}.` };
        return {
          status: "warning",
          location: a.name,
          message: `${a.occupancy} occupancies are usually ${min} or higher; the model says ${a.hazardCategory}.`,
          required: `${min} or higher (typical)`,
          actual: a.hazardCategory!,
          recommendation: "Confirm the hazard category against the DS 3-26 occupancy tables; an understated category undersizes the whole design.",
        };
      });
    },
  },
  {
    id: "nonstorage-design-density",
    title: "Sprinkler design density and area meet DS 3-26",
    dataSheet: "3-26",
    category: "Sprinkler protection",
    severity: "high",
    run(m) {
      return m.areas
        .filter((a) => a.sprinklered && !isStorageArea(a))
        .map((a): Result => {
          const s = a.sprinkler;
          const n = needs(
            {
              hazardCategory: a.hazardCategory,
              ceilingHeight_ft: a.ceilingHeight_ft,
              "sprinkler.systemType": s?.systemType,
              "sprinkler.designDensity_gpm_ft2": s?.designDensity_gpm_ft2,
              "sprinkler.designArea_ft2": s?.designArea_ft2,
            },
            a.name,
          );
          if (n) return n;
          const crit = NONSTORAGE_DEMAND[a.hazardCategory!];
          const areaFactor = s!.systemType === "wet" ? 1 : DRY_SYSTEM_AREA_FACTOR;
          const reqArea = crit.area_ft2 * areaFactor;
          const required = `${crit.density_gpm_ft2} gpm/ft² over ${fmt(reqArea)} ft²${areaFactor > 1 ? ` (${s!.systemType} system: +30% area)` : ""}`;
          const actual = `${s!.designDensity_gpm_ft2} gpm/ft² over ${fmt(s!.designArea_ft2!)} ft²`;
          if (a.ceilingHeight_ft! > NONSTORAGE_MAX_SIMPLE_CEILING_FT)
            return {
              status: "warning",
              location: a.name,
              message: `Ceiling is ${a.ceilingHeight_ft} ft; above ${NONSTORAGE_MAX_SIMPLE_CEILING_FT} ft DS 3-26 sets demand by ceiling height and sprinkler type, which this tool does not tabulate.`,
              required: "Per DS 3-26 high-ceiling tables",
              actual,
              recommendation: "Have the design checked against the DS 3-26 tables for this ceiling height.",
            };
          const lowDensity = s!.designDensity_gpm_ft2! + 1e-9 < crit.density_gpm_ft2;
          const smallArea = s!.designArea_ft2! < reqArea;
          if (!lowDensity && !smallArea) return { status: "pass", location: a.name, message: "Design density and area meet the criteria.", required, actual };
          return {
            status: "fail",
            location: a.name,
            message: [lowDensity && "design density is too low", smallArea && "design area is too small"].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase()) + ".",
            required,
            actual,
            recommendation: "Recalculate the sprinkler system hydraulically for the required density and area, then confirm the water supply can deliver it.",
          };
        });
    },
  },
  {
    id: "sprinkler-spacing",
    title: "Sprinkler spacing and coverage within DS 2-0 limits",
    dataSheet: "2-0",
    category: "Sprinkler protection",
    severity: "high",
    run(m) {
      return m.areas
        .filter((a) => a.sprinklered)
        .map((a): Result => {
          const s = a.sprinkler;
          const n = needs(
            {
              hazardCategory: a.hazardCategory,
              "sprinkler.sprinklerType": s?.sprinklerType,
              "sprinkler.maxSpacing_ft": s?.maxSpacing_ft,
              "sprinkler.maxCoveragePerSprinkler_ft2": s?.maxCoveragePerSprinkler_ft2,
            },
            a.name,
          );
          if (n) return n;
          const lim = SPACING[s!.sprinklerType!];
          let maxSpacing: number = lim.maxSpacing_ft;
          if ("highCeiling_ft" in lim && (a.ceilingHeight_ft ?? 0) > lim.highCeiling_ft) maxSpacing = lim.maxSpacingHighCeiling_ft;
          const maxCov = lim.maxCoverage_ft2[a.hazardCategory!];
          const problems: string[] = [];
          if (s!.maxSpacing_ft! > maxSpacing) problems.push(`spacing ${s!.maxSpacing_ft} ft exceeds ${maxSpacing} ft`);
          if (s!.minSpacing_ft !== null && s!.minSpacing_ft < lim.minSpacing_ft) problems.push(`spacing ${s!.minSpacing_ft} ft is below the ${lim.minSpacing_ft} ft minimum (cold-soldering risk)`);
          if (s!.maxCoveragePerSprinkler_ft2! > maxCov) problems.push(`coverage ${s!.maxCoveragePerSprinkler_ft2} ft² per sprinkler exceeds ${maxCov} ft²`);
          const required = `${lim.minSpacing_ft}–${maxSpacing} ft spacing, ≤ ${maxCov} ft² per sprinkler`;
          const actual = `${s!.minSpacing_ft ?? "?"}–${s!.maxSpacing_ft} ft, ${s!.maxCoveragePerSprinkler_ft2} ft² per sprinkler`;
          if (problems.length === 0) return { status: "pass", location: a.name, message: "Spacing and coverage are within limits.", required, actual };
          return {
            status: "fail",
            location: a.name,
            message: problems.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".",
            required,
            actual,
            recommendation: "Re-lay out the sprinklers to the DS 2-0 spacing and coverage limits for this sprinkler type.",
          };
        });
    },
  },
  {
    id: "esfr-wet-only",
    title: "ESFR sprinklers on wet systems only",
    dataSheet: "2-0",
    category: "Sprinkler protection",
    severity: "critical",
    run(m) {
      return m.areas
        .filter((a) => a.sprinklered && a.sprinkler?.sprinklerType === "esfr")
        .map((a): Result => {
          const n = needs({ "sprinkler.systemType": a.sprinkler!.systemType }, a.name);
          if (n) return n;
          if (a.sprinkler!.systemType === "wet") return { status: "pass", location: a.name, message: "ESFR sprinklers are on a wet system." };
          return {
            status: "fail",
            location: a.name,
            message: `ESFR sprinklers are on a ${a.sprinkler!.systemType} system; ESFR depends on fast water delivery and is only listed for wet systems.`,
            required: "Wet-pipe system",
            actual: a.sprinkler!.systemType!,
            recommendation: "Convert to a wet system (heat the area), or redesign with dry-system storage sprinklers per DS 8-9.",
          };
        });
    },
  },
  {
    id: "temperature-rating",
    title: "Sprinkler temperature rating suits the area",
    dataSheet: "2-0",
    category: "Sprinkler protection",
    severity: "low",
    run(m) {
      return m.areas
        .filter((a) => a.sprinklered && a.sprinkler)
        .map((a): Result => {
          const t = a.sprinkler!.temperatureRating_F;
          const n = needs({ "sprinkler.temperatureRating_F": t }, a.name);
          if (n) return n;
          const isStorage = isStorageArea(a);
          if (a.sprinkler!.sprinklerType === "esfr" && t! > 214)
            return {
              status: "warning",
              location: a.name,
              message: `ESFR rated ${t}°F; most FM ESFR designs assume ordinary (≈165°F) or intermediate (≈212°F) ratings.`,
              recommendation: "Confirm the temperature rating used in the DS 8-9 design table.",
            };
          if (!isStorage && t! > 225)
            return {
              status: "warning",
              location: a.name,
              message: `${t}°F sprinklers in a nonstorage area respond slowly unless the ambient temperature calls for them.`,
              recommendation: "Use ordinary-temperature sprinklers unless ceiling ambient temperatures require higher ratings.",
            };
          return { status: "pass", location: a.name, message: `${t}°F rating is appropriate.` };
        });
    },
  },
];
