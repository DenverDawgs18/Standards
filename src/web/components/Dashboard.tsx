import { useMemo, useState } from "react";
import { SOURCES } from "../../shared/criteria";
import { SEVERITY_ORDER } from "../../shared/engine";
import type { Category, Finding, Report, Severity, Status } from "../../shared/types";
import type { LoadedModel } from "../App";
import { STANDALONE, copyText } from "../env";

export const STATUS_META: Record<Status, { label: string; icon: string; cls: string }> = {
  fail: { label: "Fails", icon: "✕", cls: "s-fail" },
  warning: { label: "Warning", icon: "!", cls: "s-warning" },
  unknown: { label: "Needs info", icon: "?", cls: "s-unknown" },
  pass: { label: "Passes", icon: "✓", cls: "s-pass" },
};
const STATUS_ORDER: Status[] = ["fail", "warning", "unknown", "pass"];

const VERDICT = {
  "non-compliant": { title: "Does not meet FM data sheet criteria", cls: "v-fail", icon: "✕" },
  incomplete: { title: "No failures found, but some checks need more information", cls: "v-unknown", icon: "?" },
  compliant: { title: "Meets all checked FM data sheet criteria", cls: "v-pass", icon: "✓" },
} as const;

export function Dashboard({ report, loaded, onEditModel }: { report: Report; loaded: LoadedModel; onEditModel: () => void }) {
  const [statusFilter, setStatusFilter] = useState<Status | "all" | "open">("open");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const categories = useMemo(() => groupByCategory(report.findings), [report]);
  const sheets = useMemo(() => groupBySheet(report.findings), [report]);

  const filtered = report.findings.filter(
    (f) =>
      (statusFilter === "all" || (statusFilter === "open" ? f.status !== "pass" : f.status === statusFilter)) &&
      (categoryFilter === "all" || f.category === categoryFilter) &&
      (severityFilter === "all" || f.severity === severityFilter) &&
      (!query || `${f.title} ${f.message} ${f.location ?? ""} DS ${f.dataSheet}`.toLowerCase().includes(query.toLowerCase())),
  );
  const v = VERDICT[report.verdict];
  const criticalFails = report.findings.filter((f) => f.status === "fail" && f.severity === "critical").length;

  return (
    <section className="dashboard">
      <div className={`verdict ${v.cls}`}>
        <span className="verdict-icon" aria-hidden>
          {v.icon}
        </span>
        <div className="verdict-text">
          <p className="muted small">{report.buildingName}</p>
          <h2>{v.title}</h2>
          <p className="small">
            {report.counts.fail > 0
              ? `${report.counts.fail} failing check${report.counts.fail === 1 ? "" : "s"}${criticalFails ? `, ${criticalFails} critical` : ""}. Fix the critical items first — they are the most likely to lead to a large loss.`
              : report.counts.unknown > 0
                ? `Add the missing information to finish the review.`
                : `All ${report.counts.pass} checks pass.`}
          </p>
        </div>
        <div className="verdict-actions">
          <button className="btn" onClick={onEditModel}>
            Edit model
          </button>
          <button
            className="btn"
            onClick={async () => setCopied((await copyText(JSON.stringify(report, null, 2))) ? "Report copied" : "Copy blocked by the browser")}
          >
            Copy report JSON
          </button>
          {!STANDALONE && (
            <>
              <button className="btn" onClick={() => downloadReport(report)}>
                Export report
              </button>
              <button className="btn" onClick={() => window.print()}>
                Print
              </button>
            </>
          )}
          {copied && <span className="muted small" role="status">{copied}</span>}
        </div>
      </div>

      {loaded.notes.length > 0 && (
        <details className="notes">
          <summary>
            Import notes from <strong>{loaded.source}</strong> ({loaded.notes.length})
          </summary>
          <ul>
            {loaded.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Compliance score</span>
          <span className="kpi-value">{report.score}%</span>
          <span className="muted small">weighted by severity, of checks with data</span>
        </div>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`kpi kpi-btn ${statusFilter === s ? "selected" : ""}`}
            onClick={() => setStatusFilter(statusFilter === s ? "open" : s)}
            aria-pressed={statusFilter === s}
          >
            <span className="kpi-label">
              <StatusBadge status={s} />
            </span>
            <span className="kpi-value">{report.counts[s]}</span>
            <span className="muted small">{s === "unknown" ? "missing inputs" : "checks"}</span>
          </button>
        ))}
      </div>

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <h3>By category</h3>
            <Legend />
          </div>
          <div className="bars">
            {categories.map(([cat, counts]) => (
              <StackedBar
                key={cat}
                label={cat}
                counts={counts}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
              />
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>By FM data sheet</h3>
          </div>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Data sheet</th>
                <th className="num">Fail</th>
                <th className="num">Warn</th>
                <th className="num">Info</th>
                <th className="num">Pass</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map(([id, c]) => (
                <tr key={id} className={c.fail ? "row-fail" : ""}>
                  <td>
                    <span className="ds">DS {id}</span> {SOURCES[id as keyof typeof SOURCES]?.title}
                  </td>
                  <td className="num">{c.fail || ""}</td>
                  <td className="num">{c.warning || ""}</td>
                  <td className="num">{c.unknown || ""}</td>
                  <td className="num">{c.pass || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="filters">
          <h3>Findings</h3>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Status">
            <option value="open">Open issues (not passing)</option>
            <option value="all">All results</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)} aria-label="Severity">
            <option value="all">Any severity</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)} aria-label="Category">
            <option value="all">All categories</option>
            {categories.map(([c]) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search findings…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search findings" />
          <span className="muted small">
            {filtered.length} of {report.findings.length}
          </span>
        </div>
        {filtered.length === 0 ? (
          <p className="empty muted">Nothing matches these filters.</p>
        ) : (
          <ul className="findings">
            {filtered.map((f, i) => (
              <FindingRow key={`${f.ruleId}-${f.location ?? ""}-${i}`} f={f} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const src = SOURCES[f.dataSheet];
  return (
    <li className={`finding ${STATUS_META[f.status].cls}`}>
      <details>
        <summary>
          <StatusBadge status={f.status} />
          <span className={`sev sev-${f.severity}`}>{cap(f.severity)}</span>
          <span className="finding-title">
            <strong>{f.title}</strong>
            {f.location && <span className="muted"> · {f.location}</span>}
            <span className="finding-msg">{f.message}</span>
          </span>
          <span className="ds">DS {f.dataSheet}</span>
        </summary>
        <div className="finding-body">
          {(f.required || f.actual) && (
            <dl className="req">
              {f.required && (
                <>
                  <dt>Required</dt>
                  <dd>{f.required}</dd>
                </>
              )}
              {f.actual && (
                <>
                  <dt>This building</dt>
                  <dd>{f.actual}</dd>
                </>
              )}
            </dl>
          )}
          {f.missing && (
            <p>
              <strong>Missing:</strong>{" "}
              {f.missing.map((m) => (
                <code key={m} className="missing">
                  {m}
                </code>
              ))}
            </p>
          )}
          {f.recommendation && (
            <p>
              <strong>Recommendation:</strong> {f.recommendation}
            </p>
          )}
          <p className="muted small">
            Source: FM Data Sheet {src.dataSheet}, <em>{src.title}</em> — {f.category}.{" "}
            {src.confirmed ? `Criteria confirmed against ${src.edition}.` : "Criteria not yet confirmed against the current edition."}
            {"note" in src && src.note ? ` ${src.note}` : ""}
          </p>
        </div>
      </details>
    </li>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`badge ${m.cls}`}>
      <span className="badge-icon" aria-hidden>
        {m.icon}
      </span>
      {m.label}
    </span>
  );
}

function Legend() {
  return (
    <div className="legend">
      {STATUS_ORDER.map((s) => (
        <span key={s} className="legend-item">
          <span className={`swatch ${STATUS_META[s].cls}`} aria-hidden />
          {STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}

function StackedBar({ label, counts, active, onClick }: { label: string; counts: Record<Status, number>; active: boolean; onClick: () => void }) {
  const total = STATUS_ORDER.reduce((s, k) => s + counts[k], 0);
  const [hover, setHover] = useState<Status | null>(null);
  return (
    <button className={`bar-row ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="bar-label">{label}</span>
      <span className="bar-track" onMouseLeave={() => setHover(null)}>
        {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span
            key={s}
            className={`bar-seg ${STATUS_META[s].cls}`}
            style={{ flexGrow: counts[s] }}
            onMouseEnter={() => setHover(s)}
            title={`${label}: ${counts[s]} ${STATUS_META[s].label.toLowerCase()}`}
          />
        ))}
        {hover && (
          <span className="tooltip" role="tooltip">
            <StatusBadge status={hover} /> {counts[hover]} of {total}
          </span>
        )}
      </span>
      <span className="bar-value">
        {counts.fail > 0 ? <strong className="fail-text">{counts.fail} failing</strong> : <span className="muted">{counts.pass}/{total} pass</span>}
      </span>
    </button>
  );
}

function groupByCategory(findings: Finding[]): [Category, Record<Status, number>][] {
  const m = new Map<Category, Record<Status, number>>();
  for (const f of findings) {
    const c = m.get(f.category) ?? { pass: 0, fail: 0, warning: 0, unknown: 0 };
    c[f.status]++;
    m.set(f.category, c);
  }
  return [...m.entries()].sort((a, b) => b[1].fail - a[1].fail || b[1].warning - a[1].warning || a[0].localeCompare(b[0]));
}

function groupBySheet(findings: Finding[]): [string, Record<Status, number>][] {
  const m = new Map<string, Record<Status, number>>();
  for (const f of findings) {
    const c = m.get(f.dataSheet) ?? { pass: 0, fail: 0, warning: 0, unknown: 0 };
    c[f.status]++;
    m.set(f.dataSheet, c);
  }
  const key = (s: string) => s.split("-").map((n) => n.padStart(3, "0")).join("-");
  return [...m.entries()].sort((a, b) => key(a[0]).localeCompare(key(b[0])));
}

function downloadReport(report: Report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fm-compliance-report-${report.buildingName.replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
