import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

function ImportCard({ onDone }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run(dryRun) {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("dryRun", String(dryRun)); fd.append("mapping", JSON.stringify(mapping));
      const r = await api.importChecklistHistory(fd);
      setResult(r); if (!dryRun) onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="card">
      <div className="card-head"><div><span className="name">Import checklist history</span><span className="dept">From the old Google Sheet / Apps Script dashboard</span></div></div>
      <p className="meta" style={{ marginTop: 0 }}>In Google Sheets choose File → Download → Comma-separated values (.csv), then pick that file here. Entries already in the app are never overwritten, and duplicates keep the latest submission.</p>
      <input className="field" type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); setMapping({}); }} />
      {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
      {result && (
        <div className="note" style={{ marginTop: 12 }}>
          {result.dryRun ? "Preview: " : "Done: "}<strong>{result.imported}</strong> checklist{result.imported === 1 ? "" : "s"} {result.dryRun ? "will be imported" : "imported"}
          {result.alreadyInApp ? `, ${result.alreadyInApp} already in the app` : ""} (from {result.rowsInFile} rows, {result.uniqueEntries} unique person-days).
          {result.unmatched.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Names that don’t match a staff member</strong> — pick who they are, or skip:
              {result.unmatched.map((u) => (
                <div key={u.name} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <span style={{ minWidth: 150 }}>{u.name} ({u.count})</span>
                  <select className="field" style={{ maxWidth: 220 }} value={mapping[u.name] || ""} onChange={(e) => setMapping((m) => ({ ...m, [u.name]: e.target.value }))}>
                    <option value="">Leave out</option><option value="skip">Skip</option>
                    {result.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>))}
            </div>)}
        </div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-outline btn-sm" disabled={!file || busy} onClick={() => run(true)}>{busy ? "Working…" : "Preview"}</button>
        <button className="btn btn-primary btn-sm" disabled={!file || busy || !result || result.dryRun === false} onClick={() => run(false)}>Import now</button>
      </div>
    </div>
  );
}

const fmt = (iso) => (iso ? new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleString() : "—");
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function SystemPage({ user, onLogout, onBack }) {
  const [status, setStatus] = useState(null);
  const [audit, setAudit] = useState([]);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const load = () => {
    api.getSystemStatus().then(setStatus).catch((e) => setMsg(e.message));
    api.getAuditLog(100).then(setAudit).catch(() => {});
    api.getBackups().then(setBackups).catch(() => {});
  };
  useEffect(load, []);

  async function backupNow() {
    setBusy(true); setMsg("");
    try { await api.createBackup(); setMsg("Backup created."); load(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  const Row = ({ label, ok, note }) => (
    <div className="kv"><span className="k">{label}</span>
      <span className="v"><span className={`badge ${ok ? "done" : "in_progress"}`}>{ok ? "On" : "Not set up"}</span>{note && <span className="meta" style={{ marginLeft: 8 }}>{note}</span>}</span></div>
  );

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="System" onSelect={(i) => i !== "System" && onBack(i)}
        who={`${user.name} · Admin`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="System" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head">
          <div className="eyebrow">Administration</div>
          <h1>System &amp; Activity</h1>
          <p>Is the app healthy, is your data backed up, and who did what.</p>
        </div>
        {msg && <div className="note">{msg}</div>}

        {status && (
          <div className="kpi-grid">
            <div className="kpi"><div className="value">{status.users}</div><div className="label">Staff accounts</div></div>
            <div className="kpi"><div className="value">{status.tasks}</div><div className="label">Tasks recorded</div></div>
            <div className="kpi"><div className="value">{status.shiftSubmissions}</div><div className="label">Shift checklists</div></div>
            <div className="kpi"><div className="value">{Math.floor(status.uptimeSec / 3600)}h</div><div className="label">Running since restart</div></div>
          </div>
        )}

        <div className="grid-2">
          <div className="card">
            <div className="card-head"><div className="name">Connected services</div></div>
            {status && <>
              <Row label="Permanent storage (data survives restarts)" ok={status.persistentDisk} note={status.persistentDisk ? "" : "Data will be lost on redeploy — add the disk"} />
              <Row label="WhatsApp messages" ok={status.whatsappConfigured} />
              <Row label="Email (payslips, digest)" ok={status.emailConfigured} />
              <Row label="AI features" ok={status.aiConfigured} />
            </>}
          </div>
          <div className="card">
            <div className="card-head">
              <div className="name">Backups</div>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={backupNow}>{busy ? "Working…" : "Back up now"}</button>
            </div>
            <div className="meta" style={{ marginBottom: 10 }}>Automatic every night at 2 am. The last 14 are kept.</div>
            {backups.length === 0 && <div className="empty">No backups yet.</div>}
            {backups.slice(0, 6).map((b) => (
              <div className="kv" key={b.name}><span className="k">{fmt(b.at)}</span><span className="v">{size(b.bytes)}</span></div>
            ))}
          </div>
        </div>

        <ImportCard onDone={load} />

        <div className="section-head"><h2>Activity log</h2><span className="sub">Latest 100 actions</span></div>
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", color: "var(--text-muted, #64748b)" }}><th style={{ padding: "6px 8px" }}>When</th><th>Who</th><th>What</th><th>Result</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid var(--border, #e2e8f0)" }}>
                  <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{fmt(a.at)}</td>
                  <td>{a.user_name || a.user_id || "—"}</td>
                  <td>{a.action}</td>
                  <td>{a.status || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <div className="empty">Nothing recorded yet.</div>}
        </div>
      </main>
    </div>
  );
}
