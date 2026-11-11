import { DRY_SYSTEM_AREA_FACTOR, NONSTORAGE_DEMAND, STORAGE } from "../criteria";
import type { BuildingModel } from "../model";
import type { Rule } from "../types";
import { fmt, needs, type Result } from "./helpers";

const storageAreas = (m: BuildingModel) =>
  m.areas.filter((a) => a.storage && a.storage.arrangement && a.storage.arrangement !== "none" && (a.storage.height_ft ?? Infinity) > STORAGE.nonstorageMaxHeight_ft);

export const storageRules: Rule[] = [
  {
    id: "storage-design-basis",
    title: "Storage areas protected to DS 8-9 storage criteria",
    dataSheet: "8-9",
    category: "Storage",
    severity: "high",
    run(m) {
      return storageAreas(m)
        .filter((a) => a.sprinklered)
        .map((a): Result => {
          const st = a.storage!;
          const s = a.sprinkler;
          const n = needs({ "storage.height_ft": st.height_ft, "storage.commodity": st.commodity, "sprinkler.sprinklerType": s?.sprinklerType }, a.name);
          if (n) return n;
          if (s!.sprinklerType === "standard-spray")
            return {
              status: "fail",
              location: a.name,
              message: `${fmt(st.height_ft!)} ft of ${st.arrangement} storage is protected by standard-spray (nonstorage) sprinklers.`,
              required: "Storage sprinklers (ESFR or control-mode storage) designed per DS 8-9",
              actual: "Standard spray",
              recommendation: "Redesign protection using the DS 8-9 tables for this commodity, arrangement and storage height.",
            };
          if (
            st.arrangement === "rack" &&
            s!.sprinklerType === "control-mode-storage" &&
            st.height_ft! > STORAGE.ceilingOnlyControlModeMaxRack_ft &&
            !st.inRackSprinklers
          )
            return {
              status: "fail",
              location: a.name,
              message: `Rack storage ${st.height_ft} ft high relies on ceiling-only control-mode sprinklers.`,
              required: `In-rack sprinklers above ${STORAGE.ceilingOnlyControlModeMaxRack_ft} ft (or ESFR where allowed)`,
              actual: "Ceiling only",
              recommendation: "Add in-rack sprinklers per DS 8-9, or switch to an ESFR design if ceiling height permits.",
            };
          if (st.commodity === "uncartoned-plastic" && s!.sprinklerType !== "esfr" && !st.inRackSprinklers)
            return {
              status: "warning",
              location: a.name,
              message: "Uncartoned plastics are among the most demanding commodities; ceiling-only control-mode protection is often inadequate.",
              recommendation: "Confirm the design against DS 8-9 for uncartoned (exposed) plastics.",
            };
          return { status: "pass", location: a.name, message: `${s!.sprinklerType} protection is a valid DS 8-9 design basis (confirm the table values).` };
        });
    },
  },
  {
    id: "esfr-limits",
    title: "ESFR ceiling height and deflector clearance",
    dataSheet: "8-9",
    category: "Storage",
    severity: "high",
    run(m) {
      return m.areas
        .filter((a) => a.sprinklered && a.sprinkler?.sprinklerType === "esfr")
        .map((a): Result => {
          const n = needs({ ceilingHeight_ft: a.ceilingHeight_ft, "sprinkler.deflectorToTopOfStorage_ft": a.sprinkler!.deflectorToTopOfStorage_ft }, a.name);
          if (n) return n;
          const problems: string[] = [];
          if (a.ceilingHeight_ft! > STORAGE.esfrMaxCeiling_ft) problems.push(`ceiling ${a.ceilingHeight_ft} ft exceeds the ${STORAGE.esfrMaxCeiling_ft} ft ESFR limit`);
          if (a.sprinkler!.deflectorToTopOfStorage_ft! < STORAGE.minDeflectorClearance_ft)
            problems.push(`only ${a.sprinkler!.deflectorToTopOfStorage_ft} ft between deflectors and storage`);
          const required = `Ceiling ≤ ${STORAGE.esfrMaxCeiling_ft} ft; ≥ ${STORAGE.minDeflectorClearance_ft} ft clearance below deflectors`;
          const actual = `Ceiling ${a.ceilingHeight_ft} ft; ${a.sprinkler!.deflectorToTopOfStorage_ft} ft clearance`;
          if (!problems.length) return { status: "pass", location: a.name, message: "Within ESFR limits.", required, actual };
          return {
            status: "fail",
            location: a.name,
            message: problems.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".",
            required,
            actual,
            recommendation: "Lower the storage height or add in-rack sprinklers; ESFR cannot develop its spray pattern without clearance.",
          };
        });
    },
  },
];

export const waterRules: Rule[] = [
  {
    id: "water-supply-flow",
    title: "Water supply meets sprinkler + hose demand",
    dataSheet: "3-26",
    category: "Water supply",
    severity: "critical",
    run(m) {
      const w = m.waterSupply;
      const designAreas = m.areas.filter((a) => a.sprinklered && a.sprinkler?.designDensity_gpm_ft2 && a.sprinkler?.designArea_ft2 && a.hazardCategory);
      if (designAreas.length === 0)
        return [{ status: "unknown", message: "No area has a complete sprinkler design (density, area, hazard category), so the demand cannot be computed.", missing: ["areas[].sprinkler.designDensity_gpm_ft2", "areas[].sprinkler.designArea_ft2"], recommendation: "Add the sprinkler design basis for each area." }];
      const n = needs({ "waterSupply.availableFlow_gpm": w.availableFlow_gpm });
      if (n) return [n];
      let worst = { name: "", demand: 0, sprinkler: 0, hose: 0 };
      for (const a of designAreas) {
        const crit = NONSTORAGE_DEMAND[a.hazardCategory!];
        const s = a.sprinkler!;
        const density = Math.max(s.designDensity_gpm_ft2!, crit.density_gpm_ft2);
        const area = Math.max(s.designArea_ft2!, crit.area_ft2 * (s.systemType === "wet" ? 1 : DRY_SYSTEM_AREA_FACTOR));
        const sprinklerDemand = density * area;
        const demand = sprinklerDemand + crit.hose_gpm;
        if (demand > worst.demand) worst = { name: a.name, demand, sprinkler: sprinklerDemand, hose: crit.hose_gpm };
      }
      const required = `${fmt(worst.demand)} gpm (${fmt(worst.sprinkler)} sprinkler + ${fmt(worst.hose)} hose, governed by ${worst.name})`;
      const actual = `${fmt(w.availableFlow_gpm!)} gpm`;
      const uncomputed = m.areas.filter((a) => a.sprinklered && !designAreas.includes(a));
      if (w.availableFlow_gpm! >= worst.demand) {
        if (uncomputed.length)
          return [{
            status: "warning",
            message: `Supply covers the density-based demand, but ${uncomputed.map((a) => a.name).join(", ")} ha${uncomputed.length === 1 ? "s" : "ve"} no density/area design basis (e.g. ESFR, which is designed by number of sprinklers × pressure), so the governing demand may be higher.`,
            required,
            actual,
            recommendation: "Compare the supply against the hydraulic calculation for those areas (DS 8-9 ESFR demand: design sprinklers at the table pressure plus hose allowance).",
          }];
        return [{ status: "pass", message: "Available flow covers the worst-case demand.", required, actual }];
      }
      return [
        {
          status: "fail",
          message: `Available flow is ${fmt(worst.demand - w.availableFlow_gpm!)} gpm short of the governing demand.`,
          required,
          actual,
          recommendation: "Strengthen the supply (larger main, FM Approved fire pump, or suction tank per DS 3-7/3-2) and re-run the hydraulic calculation.",
        },
      ];
    },
  },
  {
    id: "water-supply-pressure",
    title: "Residual pressure meets system requirement",
    dataSheet: "3-26",
    category: "Water supply",
    severity: "critical",
    run(m) {
      const w = m.waterSupply;
      const n = needs({ "waterSupply.residualPressure_psi": w.residualPressure_psi, "waterSupply.requiredSystemPressure_psi": w.requiredSystemPressure_psi });
      if (n) return [n];
      const required = `≥ ${fmt(w.requiredSystemPressure_psi!)} psi`;
      const actual = `${fmt(w.residualPressure_psi!)} psi`;
      if (w.residualPressure_psi! >= w.requiredSystemPressure_psi!) return [{ status: "pass", message: "Residual pressure covers the calculated system pressure.", required, actual }];
      return [{ status: "fail", message: "The supply cannot deliver the pressure the hydraulic calculation needs.", required, actual, recommendation: "Add or upsize a fire pump (DS 3-7) or reduce system friction loss." }];
    },
  },
  {
    id: "water-supply-duration",
    title: "Water supply duration",
    dataSheet: "3-26",
    category: "Water supply",
    severity: "high",
    run(m) {
      const cats = m.areas.map((a) => a.hazardCategory).filter((c): c is "HC-1" | "HC-2" | "HC-3" => !!c);
      const n = needs({ "waterSupply.duration_min": m.waterSupply.duration_min, "areas[].hazardCategory": cats.length ? cats : null });
      if (n) return [n];
      const req = Math.max(...cats.map((c) => NONSTORAGE_DEMAND[c].duration_min));
      const d = m.waterSupply.duration_min!;
      if (d >= req) return [{ status: "pass", message: "Supply duration is sufficient.", required: `≥ ${req} min`, actual: `${d} min` }];
      return [{ status: "fail", message: "The supply cannot sustain the demand for the required duration.", required: `≥ ${req} min`, actual: `${d} min`, recommendation: "Increase stored water (tank capacity) or confirm the municipal supply duration." }];
    },
  },
  {
    id: "fire-pump-approved",
    title: "Fire pump is FM Approved",
    dataSheet: "3-7",
    category: "Water supply",
    severity: "high",
    run(m) {
      const w = m.waterSupply;
      if (w.firePumpPresent === false) return [];
      const n = needs({ "waterSupply.firePumpPresent": w.firePumpPresent, "waterSupply.firePumpFmApproved": w.firePumpFmApproved });
      if (n) return [n];
      if (w.firePumpFmApproved) return [{ status: "pass", message: "Fire pump is FM Approved." }];
      return [{ status: "fail", message: "Fire pump is not FM Approved.", required: "FM Approved pump, driver and controller", actual: "Not approved", recommendation: "Replace with an FM Approved fire pump assembly installed per DS 3-7." }];
    },
  },
];
