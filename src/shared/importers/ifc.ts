import { emptyArea, emptyModel, emptySprinkler, type Area, type BuildingModel, type FireWall } from "../model";

/**
 * Lightweight IFC (STEP / ISO-10303-21) reader.
 *
 * It does not build geometry. It reads the entities and property sets that
 * BIM authoring tools (Revit, ArchiCAD, Tekla…) export for code checking:
 *   - IfcProject / IfcBuilding name
 *   - IfcBuildingStorey count and elevations
 *   - IfcSpace names, areas (Qto/NetFloorArea), heights, and Pset_SpaceFireSafetyRequirements
 *   - IfcWall / IfcWallStandardCase with Pset_WallCommon.FireRating (fire walls)
 *   - IfcDoor with Pset_DoorCommon.FireRating, linked to walls through IfcRelVoidsElement/IfcRelFillsElement
 *   - IfcFireSuppressionTerminal (sprinklers) counted per space via IfcRelContainedInSpatialStructure
 *   - IfcTransformer (and IfcElectricDistributionBoard is ignored)
 *   - IfcRoof / IfcSlab(ROOF) with Pset_RoofCommon
 * Everything it cannot read stays null so the dashboard asks for it.
 */

interface Entity {
  id: number;
  type: string;
  args: unknown[];
}
type Ref = { ref: number };

export interface IfcImportResult {
  model: BuildingModel;
  notes: string[];
  stats: Record<string, number>;
}

export function parseIfc(text: string, fileName = "model.ifc"): IfcImportResult {
  if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error("Not an IFC STEP file (missing ISO-10303-21 header).");
  const entities = parseEntities(text);
  const byType = new Map<string, Entity[]>();
  for (const e of entities.values()) {
    const list = byType.get(e.type) ?? [];
    list.push(e);
    byType.set(e.type, list);
  }
  const all = (...types: string[]) => types.flatMap((t) => byType.get(t) ?? []);
  const notes: string[] = [];
  const get = (r: unknown) => (isRef(r) ? entities.get(r.ref) : undefined);
  const str = (v: unknown) => {
    const u = unwrap(v);
    return typeof u === "string" ? u : null;
  };

  // ---- property sets: object id -> { "Pset.Prop": value } ----
  const props = new Map<number, Record<string, unknown>>();
  const addProp = (objId: number, key: string, val: unknown) => {
    const p = props.get(objId) ?? {};
    p[key] = val;
    props.set(objId, p);
  };
  for (const rel of all("IFCRELDEFINESBYPROPERTIES")) {
    const objs = (rel.args[4] as unknown[]) ?? [];
    const def = get(rel.args[5]);
    if (!def) continue;
    const setName = str(def.args[2]) ?? "";
    const readValues = (items: unknown[]) => {
      for (const it of items) {
        const p = get(it);
        if (!p) continue;
        const name = str(p.args[0]);
        if (!name) continue;
        let val: unknown;
        if (p.type === "IFCPROPERTYSINGLEVALUE") val = unwrap(p.args[2]);
        else if (p.type.startsWith("IFCQUANTITY")) val = unwrap(p.args[3]);
        else continue;
        for (const o of objs) if (isRef(o)) {
          addProp(o.ref, `${setName}.${name}`, val);
          addProp(o.ref, name, val);
        }
      }
    };
    if (def.type === "IFCPROPERTYSET") readValues((def.args[4] as unknown[]) ?? []);
    else if (def.type === "IFCELEMENTQUANTITY") readValues((def.args[5] as unknown[]) ?? []);
  }
  // Type-level property sets (IfcRelDefinesByType -> HasPropertySets)
  for (const rel of all("IFCRELDEFINESBYTYPE")) {
    const typeObj = get(rel.args[5]);
    const sets = (typeObj?.args[5] as unknown[]) ?? [];
    for (const s of sets) {
      const ps = get(s);
      if (!ps || ps.type !== "IFCPROPERTYSET") continue;
      const setName = str(ps.args[2]) ?? "";
      for (const it of (ps.args[4] as unknown[]) ?? []) {
        const p = get(it);
        if (p?.type !== "IFCPROPERTYSINGLEVALUE") continue;
        const name = str(p.args[0]);
        if (!name) continue;
        for (const o of (rel.args[4] as unknown[]) ?? [])
          if (isRef(o) && !(props.get(o.ref)?.[name] !== undefined)) {
            addProp(o.ref, `${setName}.${name}`, unwrap(p.args[2]));
            addProp(o.ref, name, unwrap(p.args[2]));
          }
      }
    }
  }
  const prop = (id: number, ...names: string[]) => {
    const p = props.get(id);
    if (!p) return undefined;
    for (const n of names) if (p[n] !== undefined && p[n] !== null) return p[n];
    return undefined;
  };

  // ---- units: detect millimetres / metres for lengths and areas ----
  const lengthToFt = detectLengthFactor(all("IFCSIUNIT"), notes);
  const areaToFt2 = detectAreaFactor(all("IFCSIUNIT"), lengthToFt);

  const project = all("IFCPROJECT")[0];
  const building = all("IFCBUILDING")[0];
  const model = emptyModel(str(building?.args[2]) || str(project?.args[2]) || fileName.replace(/\.ifc$/i, ""));

  // ---- storeys ----
  const storeys = all("IFCBUILDINGSTOREY");
  if (storeys.length) {
    model.construction.stories = storeys.filter((s) => (num(s.args[9]) ?? 0) >= -0.5 / lengthToFt).length || storeys.length;
    const elevations = storeys.map((s) => num(s.args[9])).filter((n): n is number => n !== null);
    if (elevations.length) notes.push(`Found ${storeys.length} storeys.`);
  }

  // ---- containment: element -> spatial structure ----
  const containedIn = new Map<number, number>();
  for (const rel of all("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const struct = rel.args[5];
    if (!isRef(struct)) continue;
    for (const e of (rel.args[4] as unknown[]) ?? []) if (isRef(e)) containedIn.set(e.ref, struct.ref);
  }

  // ---- spaces -> areas ----
  const sprinklers = all("IFCFIRESUPPRESSIONTERMINAL", "IFCFIRESUPPRESSIONTERMINALTYPE").filter((e) => e.type === "IFCFIRESUPPRESSIONTERMINAL");
  const sprinklersBySpace = new Map<number, number>();
  for (const s of sprinklers) {
    const parent = containedIn.get(s.id);
    if (parent !== undefined) sprinklersBySpace.set(parent, (sprinklersBySpace.get(parent) ?? 0) + 1);
  }
  const spaces = all("IFCSPACE");
  for (const sp of spaces) {
    const name = [str(sp.args[2]), str(sp.args[7])].filter(Boolean).join(" — ") || `Space #${sp.id}`;
    const area: Area = emptyArea(`space-${sp.id}`, name);
    const floorArea = num(prop(sp.id, "NetFloorArea", "GrossFloorArea", "Area"));
    if (floorArea !== null) area.floorArea_ft2 = round(floorArea * areaToFt2);
    const height = num(prop(sp.id, "FinishCeilingHeight", "Height", "ClearHeight", "GrossHeight"));
    if (height !== null) area.ceilingHeight_ft = round(height * lengthToFt, 1);
    const spr = prop(sp.id, "SprinklerProtection", "SprinklerProtectionAutomatic");
    const count = sprinklersBySpace.get(sp.id) ?? 0;
    if (typeof spr === "boolean") area.sprinklered = spr;
    else if (count > 0) area.sprinklered = true;
    if (area.sprinklered) {
      area.sprinkler = emptySprinkler();
      if (count > 0 && area.floorArea_ft2) area.sprinkler.maxCoveragePerSprinkler_ft2 = round(area.floorArea_ft2 / count);
    }
    const hazard = str(prop(sp.id, "FireHazardCategory", "HazardCategory", "FM_HazardCategory"));
    const hc = hazard?.toUpperCase().match(/HC-?([123])/);
    if (hc) area.hazardCategory = `HC-${hc[1]}` as Area["hazardCategory"];
    area.occupancy = guessOccupancy(`${name} ${str(prop(sp.id, "OccupancyType", "Category")) ?? ""}`);
    model.areas.push(area);
  }
  if (!spaces.length) notes.push("No IfcSpace entities found; add the building's areas manually.");
  if (sprinklers.length) notes.push(`Counted ${sprinklers.length} sprinkler terminals; coverage per sprinkler estimated from space area ÷ count.`);

  // ---- fire walls and their openings ----
  const openingToWall = new Map<number, number>();
  for (const rel of all("IFCRELVOIDSELEMENT")) if (isRef(rel.args[4]) && isRef(rel.args[5])) openingToWall.set(rel.args[5].ref, rel.args[4].ref);
  const fillerToWall = new Map<number, number>();
  for (const rel of all("IFCRELFILLSELEMENT")) {
    if (!isRef(rel.args[4]) || !isRef(rel.args[5])) continue;
    const wall = openingToWall.get(rel.args[4].ref);
    if (wall !== undefined) fillerToWall.set(rel.args[5].ref, wall);
  }
  const walls = all("IFCWALL", "IFCWALLSTANDARDCASE");
  const fireWalls = new Map<number, FireWall>();
  let combustibleExterior = false;
  for (const w of walls) {
    const rating = parseRating(prop(w.id, "FireRating"));
    const isExternal = prop(w.id, "IsExternal") === true;
    const combustible = prop(w.id, "Combustible");
    if (isExternal && combustible === true) combustibleExterior = true;
    if (rating !== null && rating >= 1 && !isExternal) {
      fireWalls.set(w.id, { id: `wall-${w.id}`, name: str(w.args[2]) || `Wall #${w.id}`, rating_hr: rating, separates: [], openings: [] });
    }
  }
  for (const d of all("IFCDOOR", "IFCWINDOW")) {
    const wall = fillerToWall.get(d.id);
    const fw = wall !== undefined ? fireWalls.get(wall) : undefined;
    if (!fw) continue;
    fw.openings.push({ id: str(d.args[2]) || `#${d.id}`, type: d.type === "IFCDOOR" ? "door" : "window", rating_hr: parseRating(prop(d.id, "FireRating")) });
  }
  model.fireWalls = [...fireWalls.values()];
  if (fireWalls.size) notes.push(`Found ${fireWalls.size} interior walls with a FireRating ≥ 1 hr; treated as fire walls.`);
  if (walls.length) model.construction.exteriorWalls.combustibleInsulation = combustibleExterior ? true : null;

  // ---- roof ----
  const roofs = [...all("IFCROOF"), ...all("IFCSLAB").filter((s) => String(s.args[8] ?? "").includes("ROOF"))];
  for (const r of roofs) {
    const rating = str(prop(r.id, "FM_WindRating", "WindUpliftRating"));
    const m = rating?.match(/1-(\d+)/);
    if (m) model.construction.roof.windRatingClass = Number(m[1]);
    const hail = str(prop(r.id, "FM_HailRating", "HailRating"));
    if (hail === "SH" || hail === "MH") model.construction.roof.hailRating = hail;
  }
  const elevations = storeys.map((s) => num(s.args[9])).filter((n): n is number => n !== null);
  if (elevations.length >= 2) {
    // Highest storey level (usually the roof level in exported models).
    model.construction.roofHeight_ft = round(Math.max(...elevations) * lengthToFt, 1);
    notes.push("Roof height taken from the highest storey elevation; confirm it.");
  }

  // ---- transformers ----
  for (const t of all("IFCTRANSFORMER")) {
    model.transformers.push({
      id: `tx-${t.id}`,
      name: str(t.args[2]) || `Transformer #${t.id}`,
      fluid: null,
      volume_gal: null,
      distanceToBuilding_ft: null,
      adjacentWall: null,
    });
  }

  return {
    model,
    notes,
    stats: {
      entities: entities.size,
      storeys: storeys.length,
      spaces: spaces.length,
      sprinklers: sprinklers.length,
      fireWalls: fireWalls.size,
      transformers: model.transformers.length,
    },
  };
}

// ---------------------------------------------------------------- STEP parsing

function parseEntities(text: string): Map<number, Entity> {
  const out = new Map<number, Entity>();
  const dataStart = text.indexOf("DATA;");
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;
  // Split on ';' outside quotes.
  let i = 0;
  let start = 0;
  let inStr = false;
  while (i < body.length) {
    const c = body[i];
    if (c === "'") {
      if (inStr && body[i + 1] === "'") i++;
      else inStr = !inStr;
    } else if (c === ";" && !inStr) {
      const stmt = body.slice(start, i).trim();
      start = i + 1;
      const m = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)$/.exec(stmt);
      if (m) {
        try {
          out.set(Number(m[1]), { id: Number(m[1]), type: m[2], args: parseArgs(m[3]) });
        } catch {
          /* skip malformed entity */
        }
      }
    }
    i++;
  }
  return out;
}

function parseArgs(raw: string): unknown[] {
  const s = `(${raw})`;
  let pos = 0;
  const skipWs = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  };
  const parseValue = (): unknown => {
    skipWs();
    const c = s[pos];
    if (c === "(") {
      pos++;
      const list: unknown[] = [];
      skipWs();
      if (s[pos] === ")") {
        pos++;
        return list;
      }
      for (;;) {
        list.push(parseValue());
        skipWs();
        if (s[pos] === ",") pos++;
        else if (s[pos] === ")") {
          pos++;
          return list;
        } else throw new Error("bad list");
      }
    }
    if (c === "'") {
      let out = "";
      pos++;
      for (;;) {
        if (s[pos] === "'" && s[pos + 1] === "'") {
          out += "'";
          pos += 2;
        } else if (s[pos] === "'") {
          pos++;
          return { str: out };
        } else if (pos >= s.length) throw new Error("unterminated string");
        else out += s[pos++];
      }
    }
    if (c === "#") {
      const m = /^#(\d+)/.exec(s.slice(pos));
      pos += m![0].length;
      return { ref: Number(m![1]) };
    }
    if (c === "$" || c === "*") {
      pos++;
      return null;
    }
    if (c === ".") {
      const end = s.indexOf(".", pos + 1);
      const v = s.slice(pos + 1, end);
      pos = end + 1;
      if (v === "T") return true;
      if (v === "F") return false;
      if (v === "U") return null;
      return v;
    }
    // typed value e.g. IFCLABEL('x') or number
    const m = /^([A-Z][A-Z0-9_]*)\s*\(/.exec(s.slice(pos));
    if (m) {
      pos += m[0].length - 1;
      const inner = parseValue() as unknown[];
      return { typed: m[1], value: inner[0] };
    }
    const n = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\.?/.exec(s.slice(pos));
    if (n) {
      pos += n[0].length;
      return Number(n[0].replace(/\.$/, ""));
    }
    throw new Error(`unexpected '${c}'`);
  };
  return parseValue() as unknown[];
}

// strings are returned as {str}; normalise those to plain strings for callers
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && "typed" in v) return unwrap((v as unknown as { value: unknown }).value);
  if (v && typeof v === "object" && "str" in v) return decodeIfcString((v as { str: string }).str);
  return v;
}

function isRef(v: unknown): v is Ref {
  return !!v && typeof v === "object" && "ref" in v;
}

function num(v: unknown): number | null {
  const u = unwrap(v);
  if (typeof u === "number" && Number.isFinite(u)) return u;
  if (typeof u === "string" && u.trim() !== "" && Number.isFinite(Number(u))) return Number(u);
  return null;
}

function decodeIfcString(v: string | { str: string }): string {
  const s = typeof v === "string" ? v : v.str;
  return s
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/g, (_, hex: string) => hex.match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(""))
    .replace(/\\X\\([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** "2 HR", "120", "REI 120", "2h", "1.5 hour" -> hours. Bare numbers > 4 are minutes. */
export function parseRating(v: unknown): number | null {
  const u = unwrap(v);
  if (typeof u === "number") return u > 4 ? u / 60 : u;
  if (typeof u !== "string") return null;
  const m = u.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|min|minute)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] && /^m/i.test(m[2])) return n / 60;
  if (m[2]) return n;
  return n > 4 ? n / 60 : n;
}

function guessOccupancy(label: string): Area["occupancy"] {
  const l = label.toLowerCase();
  if (/data ?cent|server|it room/.test(l)) return "data-center";
  if (/warehouse|storage|rack|distribution/.test(l)) return "warehouse";
  if (/flammable|ignitable|solvent|paint/.test(l)) return "ignitable-liquid-storage";
  if (/electrical|switchgear|transformer/.test(l)) return "electrical-room";
  if (/lab/.test(l)) return "laboratory";
  if (/production|manufactur|assembly|plant|shop/.test(l)) return "manufacturing";
  if (/office|meeting|conference|reception/.test(l)) return "office";
  return null;
}

function detectLengthFactor(units: Entity[], notes: string[]): number {
  for (const u of units) {
    if (u.args[1] !== "LENGTHUNIT") continue;
    const prefix = u.args[2];
    const name = u.args[3];
    if (name !== "METRE") continue;
    const factor = prefix === "MILLI" ? 0.001 : prefix === "CENTI" ? 0.01 : 1;
    notes.push(`Model length unit: ${prefix ? String(prefix).toLowerCase() : ""}metre; converted to feet.`);
    return factor * 3.28084;
  }
  for (const u of units) if (u.type === "IFCCONVERSIONBASEDUNIT") return 1;
  return 3.28084;
}

function detectAreaFactor(units: Entity[], lengthToFt: number): number {
  for (const u of units) {
    if (u.args[1] !== "AREAUNIT" || u.args[3] !== "SQUARE_METRE") continue;
    const prefix = u.args[2];
    const f = prefix === "MILLI" ? 1e-6 : prefix === "CENTI" ? 1e-4 : 1;
    return f * 10.7639;
  }
  return lengthToFt * lengthToFt;
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
