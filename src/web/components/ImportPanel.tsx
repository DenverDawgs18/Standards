import { useEffect, useRef, useState } from "react";
import { parseIfc } from "../../shared/importers/ifc";
import { normalizeModel } from "../../shared/model";
import type { LoadedModel } from "../App";

const SAMPLES = [
  { file: "distribution-center.json", label: "Distribution center", hint: "Warehouse with ESFR racks — many issues" },
  { file: "office-compliant.json", label: "Office building", hint: "Fully compliant example" },
  { file: "small-plant.ifc", label: "Small plant (IFC)", hint: "BIM model import" },
];

const DRAWING_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];

export function ImportPanel({ onLoaded }: { onLoaded: (l: LoadedModel) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setAiAvailable(Boolean(j.blueprintExtraction)))
      .catch(() => setAiAvailable(false));
  }, []);

  async function handleFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length) return;
    setError(null);
    try {
      const drawings = files.filter((f) => DRAWING_TYPES.includes(f.type));
      const others = files.filter((f) => !DRAWING_TYPES.includes(f.type));
      if (drawings.length && others.length) throw new Error("Upload drawings (PDF/images) separately from model files (JSON/IFC).");
      if (drawings.length) return await readDrawings(drawings);
      if (others.length > 1) throw new Error("Upload one model file at a time.");
      await readModelFile(others[0].name, await others[0].text());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function readModelFile(name: string, text: string) {
    if (/\.ifc$/i.test(name) || text.startsWith("ISO-10303-21")) {
      setBusy("Reading IFC model…");
      const { model, notes, stats } = parseIfc(text, name);
      onLoaded({
        model,
        source: `${name} (IFC: ${stats.spaces} spaces, ${stats.fireWalls} fire walls, ${stats.sprinklers} sprinklers)`,
        notes: [...notes, "IFC models rarely carry water supply, site hazard or sprinkler design data; fill these in on the Model tab."],
      });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${name} is not valid JSON or IFC.`);
    }
    const { model, issues } = normalizeModel(json);
    onLoaded({ model, source: name, notes: issues.map((i) => `Schema: ${i}`) });
  }

  async function readDrawings(files: File[]) {
    const totalMb = files.reduce((s, f) => s + f.size, 0) / 1e6;
    if (totalMb > 30) throw new Error(`Drawings total ${totalMb.toFixed(1)} MB; upload at most 30 MB at a time.`);
    setBusy(`Reading ${files.length} drawing sheet${files.length > 1 ? "s" : ""} with Claude… this can take a minute or two.`);
    const payload = await Promise.all(
      files.map(async (f) => ({ fileName: f.name, mediaType: f.type, data: await toBase64(f) })),
    );
    const res = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: payload }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Extraction failed (${res.status}).`);
    onLoaded({
      model: body.model,
      source: files.map((f) => f.name).join(", "),
      notes: [
        "Extracted by AI from drawings — verify each value on the Model tab before relying on the results.",
        ...(body.notes ?? []),
        ...(body.issues ?? []).map((i: string) => `Schema: ${i}`),
      ],
    });
  }

  async function loadSample(file: string) {
    setError(null);
    setBusy(`Loading ${file}…`);
    try {
      const res = await fetch(`/${file}`);
      if (!res.ok) throw new Error(`Could not load sample ${file}.`);
      await readModelFile(file, await res.text());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="import">
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept=".json,.ifc,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="drop-icon" aria-hidden>
          ⬆
        </div>
        <h2>Drop blueprints or a building model</h2>
        <p className="muted">or click to choose files</p>
        {busy && <p className="busy" role="status">{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="import-grid">
        <ImportCard title="Blueprints / drawings" formats="PDF, PNG, JPEG">
          Plans, fire protection sheets, door schedules and design-basis tables are read by Claude and turned into a building model. Anything not on the drawings is left blank for you to fill in.
          {aiAvailable === false && (
            <p className="note warn">
              Not configured on this server: set <code>ANTHROPIC_API_KEY</code> and restart to enable.
            </p>
          )}
        </ImportCard>
        <ImportCard title="BIM model" formats="IFC 2x3 / IFC4">
          Reads spaces, areas, heights, fire ratings of walls and doors, sprinkler terminals, roof ratings and transformers from standard property sets.
        </ImportCard>
        <ImportCard title="Building model JSON" formats=".json">
          The checker's own format. Missing keys are treated as unknown. Download one from the Model tab to use as a template.
        </ImportCard>
      </div>

      <h3 className="section-title">Or try a sample</h3>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s.file} className="sample" onClick={() => loadSample(s.file)} disabled={!!busy}>
            <strong>{s.label}</strong>
            <span className="muted small">{s.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ImportCard({ title, formats, children }: { title: string; formats: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
        <span className="chip">{formats}</span>
      </div>
      <div className="muted small">{children}</div>
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
