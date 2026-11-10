import { useState } from "react";
import { normalizeModel, type BuildingModel } from "../../shared/model";

export function ModelEditor({ model, onApply }: { model: BuildingModel; onApply: (m: BuildingModel) => void }) {
  const [text, setText] = useState(() => JSON.stringify(model, null, 2));
  const [errors, setErrors] = useState<string[]>([]);

  function apply() {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      setErrors([`Invalid JSON: ${(e as Error).message}`]);
      return;
    }
    const { model: m, issues } = normalizeModel(json);
    if (issues.length) {
      setErrors(issues);
      return;
    }
    setErrors([]);
    onApply(m);
  }

  function download() {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${model.name.replace(/[^\w-]+/g, "-").toLowerCase() || "building"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="editor">
      <div className="editor-head">
        <div>
          <h2>Building model</h2>
          <p className="muted small">
            Edit values and re-run the checks. Use <code>null</code> for anything unknown — those checks show as “Needs info”. Units: ft, ft², gpm, psi, psf, mph, °F, gal, hours.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={download}>
            Download JSON
          </button>
          <button className="btn primary" onClick={apply}>
            Apply &amp; re-check
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="error-box" role="alert">
          <strong>Fix these before re-checking:</strong>
          <ul>
            {errors.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <textarea className="json" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Building model JSON" />
    </section>
  );
}
