import {
  EXTINGUISHER_MAX_TRAVEL_FT,
  FLOOD,
  IGNITABLE,
  SNOW,
  WIND,
  requiredOpeningRating,
  transformerSeparation,
} from "../criteria";
import type { Rule } from "../types";
import { fmt, hr, needs, type Result } from "./helpers";

/** Velocity pressure exposure coefficient Kz (ASCE 7 power law), used by DS 1-28. */
export function kz(height_ft: number, exposure: "B" | "C" | "D"): number {
  const { alpha, zg } = { B: { alpha: 7, zg: 1200 }, C: { alpha: 9.5, zg: 900 }, D: { alpha: 11.5, zg: 700 } }[exposure];
  const z = Math.max(height_ft, 15);
  return 2.01 * Math.pow(z / zg, 2 / alpha);
}

/** Simplified DS 1-28 roof field-zone uplift and the FM Approval class it calls for. */
export function requiredWindClass(speed_mph: number, height_ft: number, exposure: "B" | "C" | "D") {
  const q = 0.00256 * kz(height_ft, exposure) * WIND.kd * speed_mph * speed_mph;
  const uplift = q * (WIND.gcpField + WIND.gcpi);
  const needed = uplift * WIND.safetyFactor;
  const cls = Math.max(WIND.minRatingClass, Math.ceil(needed / WIND.ratingClassStep) * WIND.ratingClassStep);
  return { uplift_psf: uplift, ratingClass: cls };
}

export const constructionRules: Rule[] = [
  {
    id: "exterior-wall-combustible-insulation",
    title: "Combustible wall insulation in FM Approved assemblies",
    dataSheet: "1-57",
    category: "Construction",
    severity: "high",
    run(m) {
      const w = m.construction.exteriorWalls;
      const n = needs({ "exteriorWalls.combustibleInsulation": w.combustibleInsulation });
      if (n) return [n];
      if (!w.combustibleInsulation) return [{ status: "pass", message: "Exterior walls have no combustible insulation." }];
      if (w.fmApproved === null) return [needs({ "exteriorWalls.fmApproved": null })!];
      if (w.fmApproved) return [{ status: "pass", message: "Combustible insulation is in an FM Approved Class 1 wall assembly." }];
      return [{
        status: "fail",
        message: `Exterior walls (${w.material ?? "unknown material"}) contain combustible insulation in an assembly that is not FM Approved, which lets fire spread along the wall.`,
        required: "FM Approved Class 1 wall assembly",
        actual: "Not approved",
        recommendation: "Replace with an FM Approved Class 1 panel or noncombustible insulation (DS 1-57).",
      }];
    },
  },
  {
    id: "roof-combustible-insulation",
    title: "Roof assembly with combustible insulation is FM Approved",
    dataSheet: "1-57",
    category: "Construction",
    severity: "high",
    run(m) {
      const r = m.construction.roof;
      const n = needs({ "roof.combustibleInsulation": r.combustibleInsulation });
      if (n) return [n];
      if (!r.combustibleInsulation) return [{ status: "pass", message: "Roof has no combustible insulation." }];
      if (r.fmApprovedAssembly === null) return [needs({ "roof.fmApprovedAssembly": null })!];
      if (r.fmApprovedAssembly) return [{ status: "pass", message: "Roof assembly with combustible insulation is FM Approved Class 1." }];
      return [{ status: "fail", message: "Roof uses combustible insulation in an assembly that is not FM Approved Class 1 for interior fire spread.", required: "FM Approved Class 1 roof assembly", actual: "Not approved", recommendation: "Use an FM Approved Class 1 roof assembly (DS 1-57, DS 1-29)." }];
    },
  },
  {
    id: "concealed-spaces",
    title: "Combustible concealed spaces are sprinklered",
    dataSheet: "1-12",
    category: "Construction",
    severity: "high",
    run(m) {
      const c = m.construction.concealedSpaces;
      const n = needs({ "concealedSpaces.combustible": c.combustible });
      if (n) return [n];
      if (!c.combustible) return [{ status: "pass", message: "No combustible concealed spaces." }];
      if (c.sprinklered === null) return [needs({ "concealedSpaces.sprinklered": null })!];
      if (c.sprinklered) return [{ status: "pass", message: "Combustible concealed spaces are sprinklered." }];
      return [{ status: "fail", message: "Combustible concealed spaces (above ceilings or below floors) are not sprinklered; fire there spreads unseen.", required: "Sprinklers in combustible concealed spaces", actual: "None", recommendation: "Sprinkler the concealed spaces or fill/replace them with noncombustible materials (DS 1-12)." }];
    },
  },
  {
    id: "fire-wall-openings",
    title: "Openings in fire walls are protected",
    dataSheet: "1-23",
    category: "Fire subdivision",
    severity: "high",
    run(m) {
      const out: Result[] = [];
      for (const w of m.fireWalls) {
        if (w.rating_hr === null) {
          out.push(needs({ rating_hr: null }, w.name)!);
          continue;
        }
        for (const o of w.openings) {
          const loc = `${w.name} — ${o.type} ${o.id}`;
          if (o.rating_hr === null) {
            out.push(needs({ "opening.rating_hr": null }, loc)!);
            continue;
          }
          const req = o.type === "door" || o.type === "window" ? requiredOpeningRating(w.rating_hr) : w.rating_hr;
          if (o.rating_hr >= req) out.push({ status: "pass", location: loc, message: "Opening protection meets the wall rating.", required: `≥ ${hr(req)}`, actual: hr(o.rating_hr) });
          else
            out.push({
              status: "fail",
              location: loc,
              message: `A ${hr(w.rating_hr)} fire wall has a ${o.type} protected to only ${hr(o.rating_hr)}.`,
              required: `≥ ${hr(req)}`,
              actual: hr(o.rating_hr),
              recommendation: o.type === "door" ? "Install an FM Approved fire door assembly of the required rating, self-closing or automatic-closing." : "Protect the penetration with an FM Approved firestop/damper rated to the wall.",
            });
        }
        if (w.openings.length === 0) out.push({ status: "pass", location: w.name, message: "No openings in this fire wall." });
      }
      return out;
    },
  },
];

export const naturalHazardRules: Rule[] = [
  {
    id: "roof-wind-rating",
    title: "Roof wind uplift rating",
    dataSheet: "1-28",
    category: "Natural hazards",
    severity: "high",
    run(m) {
      const s = m.site;
      const r = m.construction.roof;
      const n = needs({ "site.designWindSpeed_mph": s.designWindSpeed_mph, "construction.roofHeight_ft": m.construction.roofHeight_ft, "roof.windRatingClass": r.windRatingClass });
      if (n) return [n];
      const exposure = s.windExposure ?? "C";
      const { uplift_psf, ratingClass } = requiredWindClass(s.designWindSpeed_mph!, m.construction.roofHeight_ft!, exposure);
      const required = `Class 1-${ratingClass} or better (field uplift ≈ ${fmt(uplift_psf, 1)} psf × ${WIND.safetyFactor} safety factor, exposure ${exposure})`;
      const actual = `Class 1-${r.windRatingClass}`;
      if (r.windRatingClass! >= ratingClass)
        return [{ status: "pass", message: "Roof field rating covers the design uplift. Perimeter and corner zones need enhanced securement per DS 1-29.", required, actual }];
      return [{ status: "fail", message: "The roof assembly's FM Approval rating is below the design uplift for this site.", required, actual, recommendation: "Specify an FM Approved roof assembly with the required rating and enhance perimeter/corner securement (DS 1-28, DS 1-29)." }];
    },
  },
  {
    id: "roof-hail",
    title: "Roof cover hail rating",
    dataSheet: "1-34",
    category: "Natural hazards",
    severity: "medium",
    run(m) {
      const n = needs({ "site.hailZone": m.site.hailZone });
      if (n) return [n];
      if (m.site.hailZone === "none") return [{ status: "pass", message: "Site is outside FM hail zones." }];
      const h = m.construction.roof.hailRating;
      if (h === null) return [needs({ "roof.hailRating": null })!];
      const ok = m.site.hailZone === "severe" ? h === "SH" : h === "SH" || h === "MH";
      const required = m.site.hailZone === "severe" ? "Severe hail (SH) rated cover" : "Moderate (MH) or severe (SH) hail rated cover";
      if (ok) return [{ status: "pass", message: "Roof cover hail rating suits the zone.", required, actual: h }];
      return [{ status: "fail", message: `Site is in a ${m.site.hailZone} hail zone but the roof cover is rated ${h}.`, required, actual: h, recommendation: "Use an FM Approved roof cover with the matching hail rating (DS 1-34)." }];
    },
  },
  {
    id: "roof-snow",
    title: "Roof designed for snow load",
    dataSheet: "1-54",
    category: "Natural hazards",
    severity: "high",
    run(m) {
      const n = needs({ "site.groundSnowLoad_psf": m.site.groundSnowLoad_psf, "roof.designSnowLoad_psf": m.construction.roof.designSnowLoad_psf });
      if (n) return [n];
      const pg = m.site.groundSnowLoad_psf!;
      if (pg === 0) return [{ status: "pass", message: "No ground snow load at this site." }];
      const req = Math.max(SNOW.minimumRoofSnow_psf, SNOW.flatRoofFactor * SNOW.exposure * SNOW.thermal * SNOW.importance * pg);
      const d = m.construction.roof.designSnowLoad_psf!;
      const required = `≥ ${fmt(req, 1)} psf flat-roof snow (excl. drifts)`;
      if (d >= req) return [{ status: "pass", message: "Roof snow design covers the uniform load. Check drift areas at roof steps separately.", required, actual: `${fmt(d, 1)} psf` }];
      return [{ status: "fail", message: "Roof snow design load is below the DS 1-54 uniform load for this site.", required, actual: `${fmt(d, 1)} psf`, recommendation: "Have a structural engineer verify roof capacity per DS 1-54, including drifts and rain-on-snow." }];
    },
  },
  {
    id: "flood-critical-equipment",
    title: "Critical equipment above design flood elevation",
    dataSheet: "1-40",
    category: "Natural hazards",
    severity: "critical",
    run(m) {
      const n = needs({ "site.floodZone": m.site.floodZone });
      if (n) return [n];
      if (m.site.floodZone === "none") return [{ status: "pass", message: "Site is outside FM 100- and 500-year flood zones." }];
      const n2 = needs({ "site.designFloodElevation_ft": m.site.designFloodElevation_ft, "criticalEquipment.lowestElevation_ft": m.criticalEquipment.lowestElevation_ft });
      if (n2) return [n2];
      const req = m.site.designFloodElevation_ft! + FLOOD.freeboard_ft;
      const act = m.criticalEquipment.lowestElevation_ft!;
      const required = `≥ ${fmt(req, 1)} ft (design flood elevation + ${FLOOD.freeboard_ft} ft)`;
      if (act >= req) return [{ status: "pass", message: "Critical equipment sits above the design flood elevation.", required, actual: `${fmt(act, 1)} ft` }];
      return [{ status: "fail", message: `Critical equipment is ${fmt(req - act, 1)} ft below the protected elevation in a ${m.site.floodZone} flood zone.`, required, actual: `${fmt(act, 1)} ft`, recommendation: "Relocate or elevate switchgear, fire pumps and generators, or provide FM Approved flood barriers and an emergency response plan (DS 1-40)." }];
    },
  },
  {
    id: "seismic-sprinkler-bracing",
    title: "Sprinkler earthquake protection",
    dataSheet: "2-8",
    category: "Natural hazards",
    severity: "high",
    run(m) {
      const n = needs({ "site.earthquakeZone": m.site.earthquakeZone });
      if (n) return [n];
      const z = m.site.earthquakeZone!;
      if (z === "none") return [{ status: "pass", message: "Site is outside FM earthquake zones." }];
      const n2 = needs({ "systems.sprinklerSeismicBracing": m.systems.sprinklerSeismicBracing, "systems.flexibleCouplings": m.systems.flexibleCouplings });
      if (n2) return [n2];
      const ok = m.systems.sprinklerSeismicBracing && m.systems.flexibleCouplings;
      if (ok) return [{ status: "pass", message: `Sprinkler piping is braced with flexible couplings (${z} zone).` }];
      const mandatory = z !== "500-yr";
      return [{
        status: mandatory ? "fail" : "warning",
        message: `Site is in an FM ${z} earthquake zone and sprinkler piping lacks ${[!m.systems.sprinklerSeismicBracing && "sway bracing", !m.systems.flexibleCouplings && "flexible couplings"].filter(Boolean).join(" and ")}.`,
        required: "Sway bracing, flexible couplings and clearances per DS 2-8",
        actual: "Incomplete",
        recommendation: "Brace sprinkler mains and risers and add flexible couplings per DS 2-8; see DS 1-2 for building and equipment anchorage.",
      }];
    },
  },
];

export const monitoringRules: Rule[] = [
  {
    id: "valve-supervision",
    title: "Sprinkler control valves supervised",
    dataSheet: "2-81",
    category: "Monitoring & maintenance",
    severity: "high",
    run(m) {
      const v = m.systems.controlValvesSupervised;
      if (v === null) return [needs({ "systems.controlValvesSupervised": v })!];
      return v
        ? [{ status: "pass", message: "Control valves are supervised." }]
        : [{ status: "fail", message: "Sprinkler control valves are not supervised; a closed valve is a leading cause of sprinkler failure.", required: "Electrical supervision or locked open with weekly inspection", actual: "Unsupervised", recommendation: "Add tamper switches monitored by the alarm system, or lock valves open and inspect weekly (DS 2-81)." }];
    },
  },
  {
    id: "waterflow-alarm",
    title: "Waterflow alarm monitored at a constantly attended location",
    dataSheet: "5-40",
    category: "Monitoring & maintenance",
    severity: "high",
    run(m) {
      const n = needs({ "systems.waterflowAlarm": m.systems.waterflowAlarm, "systems.centralStationMonitoring": m.systems.centralStationMonitoring });
      if (n) return [n];
      if (m.systems.waterflowAlarm && m.systems.centralStationMonitoring) return [{ status: "pass", message: "Waterflow alarms report to a central station." }];
      return [{ status: "fail", message: !m.systems.waterflowAlarm ? "No waterflow alarm is provided." : "Waterflow alarm is local only and not monitored off site.", required: "Waterflow alarm transmitted to a constantly attended location", actual: !m.systems.waterflowAlarm ? "None" : "Local only", recommendation: "Provide waterflow alarms transmitted to an FM Approved central station (DS 5-40)." }];
    },
  },
  {
    id: "extinguisher-travel",
    title: "Portable extinguisher travel distance",
    dataSheet: "4-5",
    category: "Monitoring & maintenance",
    severity: "low",
    run(m) {
      const d = m.systems.extinguisherMaxTravel_ft;
      if (d === null) return [needs({ "systems.extinguisherMaxTravel_ft": d })!];
      const required = `≤ ${EXTINGUISHER_MAX_TRAVEL_FT} ft`;
      return d <= EXTINGUISHER_MAX_TRAVEL_FT
        ? [{ status: "pass", message: "Extinguishers are within travel distance.", required, actual: `${d} ft` }]
        : [{ status: "fail", message: "Some locations are too far from a portable extinguisher.", required, actual: `${d} ft`, recommendation: "Add extinguishers so no point is more than 75 ft from one (DS 4-5)." }];
    },
  },
];

export const specialHazardRules: Rule[] = [
  {
    id: "smoke-vents",
    title: "Heat and smoke vents do not undermine sprinklers",
    dataSheet: "1-10",
    category: "Special hazards",
    severity: "medium",
    run(m) {
      const s = m.systems;
      if (s.smokeVentsPresent === false) return [{ status: "pass", message: "No automatic roof vents." }];
      const n = needs({ "systems.smokeVentsPresent": s.smokeVentsPresent, "systems.smokeVentsAutomatic": s.smokeVentsAutomatic });
      if (n) return [n];
      if (!s.smokeVentsAutomatic) return [{ status: "pass", message: "Roof vents are manually operated (fire service use)." }];
      const ratings = m.areas.map((a) => a.sprinkler?.temperatureRating_F).filter((t): t is number => typeof t === "number");
      const n2 = needs({ "systems.smokeVentOperatingTemp_F": s.smokeVentOperatingTemp_F, "areas[].sprinkler.temperatureRating_F": ratings.length ? ratings : null });
      if (n2) return [n2];
      const maxSpr = Math.max(...ratings);
      if (s.smokeVentOperatingTemp_F! > maxSpr)
        return [{ status: "pass", message: "Automatic vents operate after the sprinklers.", required: `> ${maxSpr}°F`, actual: `${s.smokeVentOperatingTemp_F}°F` }];
      return [{ status: "fail", message: "Automatic vents can open before the sprinklers, venting heat that sprinklers need to operate and opening more heads than designed.", required: `Operating temperature above the ${maxSpr}°F sprinklers, or manual operation`, actual: `${s.smokeVentOperatingTemp_F}°F`, recommendation: "Convert vents to manual operation or use links rated higher than the sprinklers (DS 1-10)." }];
    },
  },
  {
    id: "ignitable-liquids",
    title: "Ignitable liquid storage is cut off and contained",
    dataSheet: "7-29",
    category: "Special hazards",
    severity: "critical",
    run(m) {
      return m.areas
        .filter((a) => a.ignitableLiquids || a.occupancy === "ignitable-liquid-storage")
        .map((a): Result => {
          const il = a.ignitableLiquids;
          const n = needs({ "ignitableLiquids.quantity_gal": il?.quantity_gal }, a.name);
          if (n) return n;
          if (il!.quantity_gal! <= IGNITABLE.cutoffThreshold_gal) return { status: "pass", location: a.name, message: `${il!.quantity_gal} gal is within the small-quantity allowance.` };
          const n2 = needs({ "ignitableLiquids.cutoffRoom": il!.cutoffRoom, "ignitableLiquids.spillContainment": il!.spillContainment }, a.name);
          if (n2) return n2;
          const problems: string[] = [];
          if (!il!.cutoffRoom) problems.push("not in a cutoff room");
          else if ((il!.cutoffRating_hr ?? 0) < IGNITABLE.minCutoffRating_hr) problems.push(`cutoff rated ${il!.cutoffRating_hr ?? 0} hr`);
          if (!il!.spillContainment) problems.push("no spill containment/drainage");
          if (a.hazardCategory && a.hazardCategory !== "HC-3") problems.push(`sprinklers designed for ${a.hazardCategory} rather than an ignitable-liquid design`);
          const required = `Cutoff room ≥ ${IGNITABLE.minCutoffRating_hr} hr, spill containment, DS 7-29 sprinkler design`;
          if (!problems.length) return { status: "pass", location: a.name, message: "Ignitable liquids are cut off and contained.", required };
          return { status: "fail", location: a.name, message: `${fmt(il!.quantity_gal!)} gal of ignitable liquids: ${problems.join("; ")}.`, required, actual: problems.join("; "), recommendation: "Move the liquids into a rated cutoff room with containment and drainage and protect per DS 7-29." };
        });
    },
  },
  {
    id: "data-center",
    title: "Data center fire protection",
    dataSheet: "5-32",
    category: "Special hazards",
    severity: "high",
    run(m) {
      return m.areas
        .filter((a) => a.occupancy === "data-center")
        .map((a): Result => {
          const n = needs({ sprinklered: a.sprinklered, smokeDetection: a.smokeDetection }, a.name);
          if (n) return n;
          const problems = [!a.sprinklered && "no automatic sprinklers", !a.smokeDetection && "no smoke detection"].filter(Boolean);
          if (!problems.length) return { status: "pass", location: a.name, message: "Sprinklers and smoke detection provided." };
          return { status: "fail", location: a.name, message: `Data center has ${problems.join(" and ")}.`, required: "Sprinklers (wet or preaction) plus early-warning smoke detection", actual: problems.join(", "), recommendation: "Provide sprinklers and smoke detection per DS 5-32; gaseous systems supplement but do not replace sprinklers." };
        });
    },
  },
  {
    id: "transformer-separation",
    title: "Outdoor transformer separation from buildings",
    dataSheet: "5-4",
    category: "Special hazards",
    severity: "high",
    run(m) {
      return m.transformers.map((t): Result => {
        const n = needs({ fluid: t.fluid }, t.name);
        if (n) return n;
        if (t.fluid === "dry-type") return { status: "pass", location: t.name, message: "Dry-type transformer: no liquid pool-fire exposure." };
        const n2 = needs({ volume_gal: t.volume_gal, distanceToBuilding_ft: t.distanceToBuilding_ft, adjacentWall: t.adjacentWall }, t.name);
        if (n2) return n2;
        const req = transformerSeparation(t.fluid!, t.volume_gal!, t.adjacentWall!);
        const required = `≥ ${req} ft from a ${t.adjacentWall} wall (${fmt(t.volume_gal!)} gal ${t.fluid})`;
        if (t.distanceToBuilding_ft! >= req) return { status: "pass", location: t.name, message: "Separation is sufficient.", required, actual: `${t.distanceToBuilding_ft} ft` };
        return { status: "fail", location: t.name, message: `Transformer is ${fmt(req - t.distanceToBuilding_ft!)} ft too close to the building.`, required, actual: `${t.distanceToBuilding_ft} ft`, recommendation: "Relocate the transformer, upgrade the exposed wall to 2-hr fire-rated construction, or add a water-spray system (DS 5-4)." };
      });
    },
  },
];
