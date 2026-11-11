import { useMemo, useState } from "react";
import { evaluate } from "../shared/engine";
import type { BuildingModel } from "../shared/model";
import { Dashboard } from "./components/Dashboard";
import { ImportPanel } from "./components/ImportPanel";
import { ModelEditor } from "./components/ModelEditor";

type View = "import" | "dashboard" | "model";

export interface LoadedModel {
  model: BuildingModel;
  source: string;
  notes: string[];
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [view, setView] = useState<View>("import");
  const report = useMemo(() => (loaded ? evaluate(loaded.model) : null), [loaded]);

  const onLoaded = (l: LoadedModel) => {
    setLoaded(l);
    setView("dashboard");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ✓
          </span>
          <div>
            <h1>FM Standards Checker</h1>
            <p className="muted small">Building models vs. FM Property Loss Prevention Data Sheets</p>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          <Tab id="import" view={view} setView={setView}>
            Import
          </Tab>
          <Tab id="dashboard" view={view} setView={setView} disabled={!report}>
            Dashboard
            {report && report.counts.fail > 0 && <span className="tab-badge">{report.counts.fail}</span>}
          </Tab>
          <Tab id="model" view={view} setView={setView} disabled={!loaded}>
            Model
          </Tab>
        </nav>
      </header>

      <main>
        {view === "import" && <ImportPanel onLoaded={onLoaded} />}
        {view === "dashboard" && report && loaded && (
          <Dashboard report={report} loaded={loaded} onEditModel={() => setView("model")} />
        )}
        {view === "model" && loaded && (
          <ModelEditor
            model={loaded.model}
            onApply={(model) => {
              setLoaded({ ...loaded, model });
              setView("dashboard");
            }}
          />
        )}
      </main>

      <footer className="footer muted small">
        Criteria are a simplified encoding of FM Data Sheets and are marked unconfirmed until checked against the current edition.
        This tool supports — it does not replace — review by a qualified fire protection engineer or FM engineer.
      </footer>
    </div>
  );
}

function Tab(props: { id: View; view: View; setView: (v: View) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={props.view === props.id}
      className={`tab ${props.view === props.id ? "active" : ""}`}
      disabled={props.disabled}
      onClick={() => props.setView(props.id)}
    >
      {props.children}
    </button>
  );
}
