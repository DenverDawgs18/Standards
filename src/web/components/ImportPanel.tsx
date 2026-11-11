import { useRef, useState } from "react";
import { parseIfc } from "../../shared/importers/ifc";
import { normalizeModel } from "../../shared/model";
import type { LoadedModel } from "../App";
import distributionCenter from "../../../samples/distribution-center.json?raw";
import officeCompliant from "../../../samples/office-compliant.json?raw";
import smallPlant from "../../../samples/small-plant.ifc?raw";

const SAMPLES = [
  { file: "distribution-center.json", text: distributionCenter, label: "Distribution center", hint: "Warehouse with ESFR racks — many issues" },
  { file: "office-compliant.json", text: officeCompliant, label: "Office building", hint: "Fully compliant example" },
  { file: "small-plant.ifc", text: smallPlant, label: "Small plant (IFC)", hint: "BIM model import" },
];

export function ImportPanel({ onLoaded }: { onLoaded: (l: LoadedModel) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length) return;
    setError(null);
    try {
      if (files.length > 1) throw new Error("Upload one model file at a time.");
      const file = files[0];
      if (!/\.(json|ifc)$/i.test(file.name)) throw new Error(`${file.name} isn't a supported file. Upload a building model as .json or .ifc.`);
      await readModelFile(file.name, await file.text());
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

  async function loadSample(file: string, text: string) {
    setError(null);
    try {
      await readModelFile(file, text);
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
          accept=".json,.ifc"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="drop-icon" aria-hidden>
          ⬆
        </div>
        <h2>Drop a building model</h2>
        <p className="muted">IFC or JSON — or click to choose a file</p>
        {busy && <p className="busy" role="status">{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="import-grid">
        <ImportCard title="BIM model" formats="IFC 2x3 / IFC4">
          Reads spaces, areas, heights, fire ratings of walls and doors, sprinkler terminals, roof ratings and transformers from standard property sets.
        </ImportCard>
        <ImportCard title="Building model JSON" formats=".json">
          The checker's own format. Missing keys are treated as unknown. Copy one from the Model tab to use as a template.
        </ImportCard>
      </div>

      <h3 className="section-title">Or try a sample</h3>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s.file} className="sample" onClick={() => loadSample(s.file, s.text)} disabled={!!busy}>
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

