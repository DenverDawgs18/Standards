import Anthropic from "@anthropic-ai/sdk";
import { emptyModel, normalizeModel, type BuildingModel } from "../src/shared/model";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export interface ExtractInput {
  fileName: string;
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
  notes?: string;
}

export interface ExtractResult {
  model: BuildingModel;
  notes: string[];
  issues: string[];
}

const SYSTEM = `You are a fire protection engineer reading construction drawings (plans, sections, fire protection sheets, life-safety plans, schedules and general notes) to build a property-risk model for checking against FM Property Loss Prevention Data Sheets.

Return ONLY facts that the drawings state or clearly show. When a value is not on the drawings, use null; never guess a value to fill a field. The dashboard asks the user for every null, so a null is far better than an invented number.

Conventions:
- US units: feet, square feet, gpm, psi, psf, mph, °F, gallons, hours. Convert metric values.
- One "areas" entry per fire area/occupancy zone (e.g. a warehouse, an office block, an electrical room), not per small room.
- Hazard category: HC-1, HC-2 or HC-3 per FM DS 3-26 only if the drawings state it or the occupancy is unambiguous (offices HC-1). Otherwise null.
- Fire walls: walls marked with a fire-resistance rating of 1 hr or more that separate areas; list their doors/openings with the opening ratings shown in door schedules.
- Sprinkler data typically comes from the fire protection sheets' design basis table (density, design area, sprinkler type, K-factor, temperature, max spacing).
- Water supply data typically comes from a flow test note (static/residual/flow) and the hydraulic summary (required flow and pressure).
- "windRatingClass" is the number after "1-" in an FM Approval roof rating (Class 1-90 → 90).`;

const FORMAT = `Respond with one JSON object in a \`\`\`json code block, with this shape (all leaf values may be null):
{
  "model": ${JSON.stringify(emptyModel("<building name>"))},
  "areaShape": {"id":"a1","name":"...","occupancy":"office|manufacturing|warehouse|data-center|laboratory|ignitable-liquid-storage|electrical-room|other","hazardCategory":"HC-1|HC-2|HC-3","floorArea_ft2":0,"ceilingHeight_ft":0,"sprinklered":true,"sprinkler":{"systemType":"wet|dry|preaction","sprinklerType":"standard-spray|esfr|control-mode-storage","kFactor":0,"temperatureRating_F":0,"maxSpacing_ft":0,"minSpacing_ft":0,"maxCoveragePerSprinkler_ft2":0,"designDensity_gpm_ft2":0,"designArea_ft2":0,"deflectorToTopOfStorage_ft":0},"storage":{"arrangement":"none|rack|solid-pile|palletized|shelf","height_ft":0,"commodity":"class-1-3|class-4|cartoned-unexpanded-plastic|cartoned-expanded-plastic|uncartoned-plastic","inRackSprinklers":false},"ignitableLiquids":{"quantity_gal":0,"cutoffRoom":false,"cutoffRating_hr":0,"spillContainment":false},"smokeDetection":false},
  "fireWallShape": {"id":"fw1","name":"...","rating_hr":2,"separates":["a1","a2"],"openings":[{"id":"D101","type":"door|duct|penetration|window","rating_hr":1.5}]},
  "transformerShape": {"id":"t1","name":"...","fluid":"mineral-oil|less-flammable|dry-type","volume_gal":0,"distanceToBuilding_ft":0,"adjacentWall":"2-hr-fire-rated|noncombustible|combustible"},
  "notes": ["short notes on where values came from, conflicts between sheets, or what is missing"]
}
Put areas, fire walls and transformers in model.areas / model.fireWalls / model.transformers using the shapes above. Omit "areaShape", "fireWallShape" and "transformerShape" from your answer.`;

export async function extractFromBlueprint(files: ExtractInput[]): Promise<ExtractResult> {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    if (f.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.fileName });
    } else if ((IMAGE_TYPES as readonly string[]).includes(f.mediaType)) {
      content.push({ type: "text", text: `Sheet: ${f.fileName}` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as ImageType, data: f.data } });
    } else {
      throw new Error(`Unsupported file type ${f.mediaType} (${f.fileName}). Upload PDF, PNG, JPEG, GIF or WebP.`);
    }
  }
  const userNotes = files.map((f) => f.notes).filter(Boolean).join("\n");
  content.push({
    type: "text",
    text: `Build the property-risk model from these drawings.${userNotes ? `\n\nNotes from the user:\n${userNotes}` : ""}\n\n${FORMAT}`,
  });

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(`The model declined to read these drawings${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : "."}`);
  }
  if (message.stop_reason === "max_tokens") throw new Error("The drawing set produced too much output; upload fewer sheets at a time.");

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const json = extractJson(text);
  if (!json || typeof json !== "object") throw new Error("Could not read a model from the response.");
  const { model: raw, notes } = json as { model?: unknown; notes?: unknown };
  const { model, issues } = normalizeModel(raw ?? {});
  return { model, notes: Array.isArray(notes) ? notes.map(String) : [], issues };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
