import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/shared/engine";
import { parseIfc, parseRating } from "../src/shared/importers/ifc";
import { emptyModel, normalizeModel } from "../src/shared/model";
import { requiredWindClass } from "../src/shared/rules/building";
import { transformerSeparation } from "../src/shared/criteria";

const load = (f: string) => normalizeModel(JSON.parse(readFileSync(new URL(`../samples/${f}`, import.meta.url), "utf8")));
const statusOf = (report: ReturnType<typeof evaluate>, ruleId: string, location?: string) =>
  report.findings.filter((f) => f.ruleId === ruleId && (location === undefined || f.location === location)).map((f) => f.status);

describe("sample models", () => {
  it("parses both samples without schema issues", () => {
    expect(load("distribution-center.json").issues).toEqual([]);
    expect(load("office-compliant.json").issues).toEqual([]);
  });

  it("flags the distribution center's known problems", () => {
    const r = evaluate(load("distribution-center.json").model);
    expect(r.verdict).toBe("non-compliant");
    expect(statusOf(r, "sprinklers-throughout", "Forklift battery charging")).toEqual(["fail"]);
    expect(statusOf(r, "esfr-wet-only")).toEqual(["fail"]);
    expect(statusOf(r, "esfr-limits")).toEqual(["fail"]);
    expect(statusOf(r, "nonstorage-design-density", "Maintenance shop")).toEqual(["fail"]);
    expect(statusOf(r, "fire-wall-openings").sort()).toEqual(["fail", "pass", "unknown"]);
    expect(statusOf(r, "roof-wind-rating")).toEqual(["fail"]);
    expect(statusOf(r, "roof-hail")).toEqual(["fail"]);
    expect(statusOf(r, "flood-critical-equipment")).toEqual(["fail"]);
    expect(statusOf(r, "seismic-sprinkler-bracing")).toEqual(["fail"]);
    expect(statusOf(r, "valve-supervision")).toEqual(["fail"]);
    expect(statusOf(r, "waterflow-alarm")).toEqual(["fail"]);
    expect(statusOf(r, "smoke-vents")).toEqual(["fail"]);
    expect(statusOf(r, "ignitable-liquids")).toEqual(["fail"]);
    expect(statusOf(r, "transformer-separation")).toEqual(["fail"]);
    expect(statusOf(r, "exterior-wall-combustible-insulation")).toEqual(["fail"]);
    expect(statusOf(r, "water-supply-pressure")).toEqual(["fail"]);
    expect(statusOf(r, "water-supply-flow")).toEqual(["warning"]);
  });

  it("passes the compliant office", () => {
    const r = evaluate(load("office-compliant.json").model);
    const bad = r.findings.filter((f) => f.status === "fail" || f.status === "unknown");
    expect(bad).toEqual([]);
    expect(r.verdict).toBe("compliant");
    expect(r.score).toBe(100);
  });
});

describe("criteria", () => {
  it("adds 30% design area for dry systems", () => {
    const m = load("office-compliant.json").model;
    m.areas[0].sprinkler!.systemType = "dry";
    const r = evaluate(m);
    expect(statusOf(r, "nonstorage-design-density", "Offices, floors 1–3")).toEqual(["fail"]);
    m.areas[0].sprinkler!.designArea_ft2 = 1950;
    expect(statusOf(evaluate(m), "nonstorage-design-density", "Offices, floors 1–3")).toEqual(["pass"]);
  });

  it("computes a wind rating class in 15-step increments with the safety factor", () => {
    const { ratingClass, uplift_psf } = requiredWindClass(130, 42, "C");
    expect(uplift_psf).toBeGreaterThan(40);
    expect(ratingClass % 15).toBe(0);
    expect(ratingClass).toBeGreaterThanOrEqual(90);
    expect(requiredWindClass(90, 20, "B").ratingClass).toBe(60);
  });

  it("scales transformer separation with volume and wall construction", () => {
    expect(transformerSeparation("mineral-oil", 400, "2-hr-fire-rated")).toBe(5);
    expect(transformerSeparation("mineral-oil", 650, "noncombustible")).toBe(25);
    expect(transformerSeparation("mineral-oil", 6000, "combustible")).toBe(100);
  });

  it("reports unknowns instead of guessing", () => {
    const r = evaluate(emptyModel());
    expect(r.counts.fail).toBe(0);
    expect(r.verdict).toBe("incomplete");
    expect(r.findings.every((f) => f.status === "unknown" || f.status === "pass")).toBe(true);
  });
});

describe("IFC import", () => {
  const text = readFileSync(new URL("../samples/small-plant.ifc", import.meta.url), "utf8");

  it("reads spaces, units, psets, fire walls and doors", () => {
    const { model, stats } = parseIfc(text);
    expect(model.name).toBe("Lakeside Components Plant");
    expect(stats.spaces).toBe(3);
    const hall = model.areas.find((a) => a.name.includes("Production Hall"))!;
    expect(hall.floorArea_ft2).toBeCloseTo(2400 * 10.7639, -1);
    expect(hall.ceilingHeight_ft).toBeCloseTo(27.9, 1);
    expect(hall.hazardCategory).toBe("HC-2");
    expect(hall.occupancy).toBe("manufacturing");
    expect(hall.sprinklered).toBe(true);
    const paint = model.areas.find((a) => a.name.includes("Paint"))!;
    expect(paint.sprinklered).toBe(false);
    expect(paint.occupancy).toBe("ignitable-liquid-storage");
    expect(model.fireWalls).toHaveLength(1);
    expect(model.fireWalls[0].rating_hr).toBe(2);
    expect(model.fireWalls[0].openings).toEqual([{ id: "D-12", type: "door", rating_hr: 1 }]);
    expect(model.construction.roof.windRatingClass).toBe(75);
    expect(model.construction.roof.hailRating).toBe("MH");
    expect(model.construction.roofHeight_ft).toBeCloseTo(29.5, 1);
    expect(model.transformers).toHaveLength(1);
  });

  it("feeds the engine", () => {
    const r = evaluate(parseIfc(text).model);
    expect(statusOf(r, "sprinklers-throughout", "103 — Paint Store")).toEqual(["fail"]);
    expect(statusOf(r, "fire-wall-openings")).toEqual(["fail"]);
  });

  it("parses fire rating strings", () => {
    expect(parseRating("2 HR")).toBe(2);
    expect(parseRating("REI 120")).toBe(2);
    expect(parseRating("90 min")).toBe(1.5);
    expect(parseRating(1.5)).toBe(1.5);
  });

  it("rejects non-IFC text", () => {
    expect(() => parseIfc("hello")).toThrow();
  });
});
