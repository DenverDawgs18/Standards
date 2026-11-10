import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromBlueprint, type ExtractInput } from "./extract";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "45mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, blueprintExtraction: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

app.post("/api/extract", async (req, res) => {
  const files = (req.body?.files ?? []) as ExtractInput[];
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: "Send { files: [{ fileName, mediaType, data }] } with base64 data." });
    return;
  }
  try {
    res.json(await extractFromBlueprint(files));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(503).json({ error: "Blueprint reading is not configured: set ANTHROPIC_API_KEY on the server." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "Rate limited by the Claude API; try again shortly." });
    } else if (err instanceof Anthropic.BadRequestError) {
      res.status(400).json({ error: `The drawings could not be processed: ${err.message}` });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `Claude API error ${err.status ?? ""}: ${err.message}` });
    } else if (err instanceof Anthropic.AnthropicError) {
      // Raised by the SDK before any request is sent, e.g. no credentials configured.
      res.status(503).json({ error: `Blueprint reading is not configured: set ANTHROPIC_API_KEY on the server. (${err.message})` });
    } else {
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(here, "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`FM standards checker listening on http://localhost:${port}`));
