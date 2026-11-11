# FM Standards Checker

A web app that checks a building against criteria from the **FM Property Loss Prevention Data Sheets** and shows a dashboard of what passes, what fails, and what information is still missing.

You can give it:

| Input | How it's read |
|---|---|
| **Blueprints / drawings** (PDF, PNG, JPEG, GIF, WebP) | Sent to Claude (`claude-opus-5-5`), which pulls out facts the drawings state (sprinkler design basis, fire wall and door ratings, flow test, roof rating…) and leaves everything else blank. Needs `ANTHROPIC_API_KEY` on the server. |
| **BIM model** (IFC 2x3 / IFC4 `.ifc`) | Parsed in the browser: spaces, floor areas, heights, `Pset_SpaceFireSafetyRequirements`, wall and door `FireRating`, sprinkler terminals, roof ratings, transformers. |
| **Building model JSON** | The app's own format (`src/shared/model.ts`). Missing keys are treated as unknown. |

Every check returns **Passes**, **Fails**, **Warning**, or **Needs info**. A missing value never gets guessed: the check asks for it.

## Running it

```bash
npm install
```

```bash
npm run dev          # API on :8787 and Vite on :5173
```

```bash
npm run build && npm start   # production: one server on :8787 (PORT to change)
```

To read blueprints, set `ANTHROPIC_API_KEY` in the server's environment (optionally `CLAUDE_MODEL`). JSON and IFC imports work without it.

```bash
npm test             # rules engine + IFC importer tests
```

## Deploying (Fly.io)

`fly.toml` runs one `shared-cpu-1x` machine that scales to zero: Fly stops it when idle and starts it on the next request, so the first request after a quiet spell takes a few seconds.

```bash
fly deploy --ha=false
```

To enable blueprint reading on the deployed app:

```bash
fly secrets set ANTHROPIC_API_KEY=your-key
```

## What it checks

| Data sheet | Check |
|---|---|
| DS 2-0 | Sprinkler spacing and coverage per sprinkler; ESFR on wet systems only; temperature rating |
| DS 2-8 / 1-2 | Sway bracing and flexible couplings in FM earthquake zones |
| DS 2-81 | Control valve supervision |
| DS 3-26 | Sprinklers throughout; design density and area by hazard category (with +30% for dry/preaction); water supply flow, pressure and duration; hazard category vs. occupancy |
| DS 3-7 | Fire pump FM Approved |
| DS 8-9 | Storage over 5 ft protected with storage sprinklers; in-rack sprinklers for tall ceiling-only racks; ESFR ceiling height and deflector clearance |
| DS 1-12 | Combustible concealed spaces sprinklered |
| DS 1-23 | Fire wall door/penetration ratings vs. wall rating |
| DS 1-28 / 1-29 | Roof FM Approval wind class vs. design uplift × 2 |
| DS 1-34 | Roof cover hail rating vs. hail zone |
| DS 1-40 | Critical equipment above design flood elevation |
| DS 1-54 | Roof snow design load |
| DS 1-57 | Combustible wall/roof insulation in FM Approved assemblies |
| DS 1-10 | Automatic smoke/heat vents operating after sprinklers |
| DS 4-5 | Extinguisher travel distance |
| DS 5-4 | Outdoor transformer separation by fluid, volume and wall construction |
| DS 5-32 | Data centers: sprinklers plus smoke detection |
| DS 5-40 | Waterflow alarm monitored off site |
| DS 7-29 | Ignitable liquids cut off, contained, and HC-3 or better |

## About the criteria — read this

The data sheets are published by FM and revised often. fm.com could not be read from the environment this was built in, so the numeric values in `src/shared/criteria.ts` are a **simplified encoding** of published criteria, cross-checked against public summaries where possible (DS 3-26 hose allowances and duration, DS 5-4 volume tiers). Each data sheet entry has `edition` and `confirmed` fields, and the dashboard shows on every finding whether its criteria are confirmed.

Before relying on the results:

1. Download the current editions from fm.com (free with registration).
2. Check each value in `src/shared/criteria.ts` against the sheet, then set `confirmed: true` and `edition`.
3. Remember that several sheets (DS 8-9 storage tables, DS 3-26 high-ceiling tables, DS 1-28 zone pressures) are much more detailed than a rule engine of this size captures; the app says so where it applies.

This tool supports, but does not replace, review by a qualified fire protection engineer or FM engineer.

## Layout

```
src/shared/model.ts          building model schema (zod)
src/shared/criteria.ts       numeric criteria per data sheet + source/edition status
src/shared/rules/*.ts        the checks
src/shared/engine.ts         runs checks, scores, verdict
src/shared/importers/ifc.ts  IFC STEP reader
server/                      Express server + Claude blueprint extraction
src/web/                     React dashboard
samples/                     example JSON and IFC models
tests/                       vitest
```

Adding a check: write a `Rule` in `src/shared/rules/`, add it to `RULES` in `engine.ts`, add any numbers to `criteria.ts`, and add a test.
