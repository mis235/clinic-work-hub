import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

function EmailCard({ onChanged }) {
  const [cur, setCur] = useState(null);
  const [user, setUser] = useState(""); const [pass, setPass] = useState(""); const [to, setTo] = useState("");
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.emailSettings().then((r) => { setCur(r); setUser(r.user || ""); }).catch(() => {});
  useEffect(() => { load(); }, []);
  async function save() {
    setBusy(true); setMsg(null);
    try { await api.saveEmailSettings({ user, pass }); setPass(""); setMsg({ ok: true, t: "Saved. Now press “Send test email”." }); load(); onChanged?.(); } catch (e) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg(null);
    try { const r = await api.testEmail(to || user); setMsg({ ok: true, t: `Test email sent to ${r.to}. Check that inbox (and Spam).` }); } catch (e) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  }
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><div><span className="name">Email settings</span><span className="dept">Needed to email payslips and letters to staff</span></div>
        <span className={`badge ${cur?.configured ? "done" : "overdue"}`}>{cur?.configured ? "Set up" : "Not set up"}</span></div>
      <ol className="meta" style={{ lineHeight: 1.8, paddingLeft: 18, marginTop: 0 }}>
        <li>Use the clinic's Gmail address that should send the emails.</li>
        <li>In that Google account: Security → turn on <b>2-Step Verification</b>, then search “<b>App passwords</b>” and create one (name it Work Hub). Google shows 16 letters.</li>
        <li>Paste the address and those 16 letters below, press Save, then Send test email.</li>
      </ol>
      <div className="form-grid">
        <div><label className="field-label">Gmail address</label><input className="field" value={user} onChange={(e) => setUser(e.target.value)} placeholder="payroll@drnishitaranka.com" /></div>
        <div><label className="field-label">App password {cur?.hasPassword && "(saved — leave empty to keep)"}</label><input className="field" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="16 letters" autoComplete="new-password" /></div>
        <div><label className="field-label">Send the test to (optional)</label><input className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="your own email" /></div>
      </div>
      {msg && <div className={msg.ok ? "note" : "login-error"} style={{ marginTop: 10 }}>{msg.t}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={busy || !user} onClick={save}>Save</button>
        <button className="btn btn-outline btn-sm" disabled={busy || !cur?.configured} onClick={test}>Send test email</button>
      </div>
      <div className="meta" style={{ marginTop: 10 }}>If Google says app passwords are not available, the Workspace admin must allow them (Admin console → Security).</div>
    </div>
  );
}

const mb = (b) => (b == null ? "—" : b > 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function BackupCopyCard({ onChanged }) {
  const [cur, setCur] = useState(null); const [dir, setDir] = useState(""); const [big, setBig] = useState(false); const [time, setTime] = useState("18:30"); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.backupCopy().then((r) => { setCur(r); setDir(r.dir || ""); setBig(!!r.includeBig); setTime(r.time || "18:30"); }).catch(() => {});
  useEffect(() => { load(); }, []);
  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await api.saveBackupCopy(dir, big, time); setMsg({ ok: true, t: r.dir ? "Saved. A backup was copied there just now." : "Extra copy turned off." }); load(); onChanged?.(); } catch (e) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  }
  const st = cur?.status;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><div><span className="name">Safe copy outside this app (Google Drive)</span><span className="dept">Every night the database and all photos/files are also copied to this folder</span></div>
        <span className={`badge ${cur?.dir ? (st && !st.ok ? "overdue" : "done") : "overdue"}`}>{cur?.dir ? (st && !st.ok ? "Problem" : "On") : "Not set up"}</span></div>
      <ol className="meta" style={{ lineHeight: 1.8, paddingLeft: 18, marginTop: 0 }}>
        <li>On the computer that runs the app, install <b>Google Drive for desktop</b> (free) and sign in with the clinic Google account.</li>
        <li>In File Explorer open the Drive (usually <b>G:\My Drive</b>) and make a folder called <b>ClinicBackups</b>.</li>
        <li>Paste the full path below, e.g. <b>G:\My Drive\ClinicBackups</b>, and press Save. Drive uploads it to the cloud by itself.</li>
      </ol>
      <input className="field" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="G:\My Drive\ClinicBackups" />
      <label className="field-label" style={{ marginTop: 10 }}>Back up every day at (office time)</label>
      <input className="field" type="time" style={{ maxWidth: 160 }} value={time} onChange={(e) => setTime(e.target.value)} />
      <div className="meta">If the computer is off at that time, the backup runs as soon as the app is on again.</div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 13 }}><input type="checkbox" checked={big} onChange={(e) => setBig(e.target.checked)} style={{ marginTop: 3 }} /><span>Also copy training videos and face check-in photos <span className="meta">(they use a lot of space — leave this off unless you have plenty of Drive space)</span></span></label>
      {st && <div className="meta" style={{ marginTop: 8 }}>Last copy: {new Date(st.at).toLocaleString("en-IN")} — {st.ok ? `OK (${st.files} new files copied)` : <span style={{ color: "var(--red)" }}>{st.error}</span>}</div>}
      {msg && <div className={msg.ok ? "note" : "login-error"} style={{ marginTop: 10 }}>{msg.t}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Working…" : "Save & copy now"}</button></div>
      <div className="meta" style={{ marginTop: 10 }}>This protects you if the computer breaks. It does not keep the app running when the computer is off — that needs the cloud server.</div>
    </div>
  );
}

function StorageCard() {
  const [s, setS] = useState(null); const [msg, setMsg] = useState("");
  const load = () => api.storage().then(setS).catch(() => {});
  useEffect(() => { load(); }, []);
  async function clean() { try { const r = await api.cleanSnapshots(90); setMsg(`Removed ${r.removed} old check-in photo${r.removed === 1 ? "" : "s"} (${mb(r.bytes)}).`); load(); } catch (e) { setMsg(e.message); } }
  if (!s) return null;
  const used = s.parts.reduce((t, p) => t + p.bytes, 0);
  const lowDisk = s.free != null && s.free < 5 * 1073741824;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><div><span className="name">Storage</span><span className="dept">What the app is using on this computer</span></div><span className="badge done">{mb(used)}</span></div>
      {s.parts.map((p) => <div className="kv" key={p.name}><span className="k">{p.name}</span><span className="v">{mb(p.bytes)}</span></div>)}
      {s.free != null && <div className="kv"><span className="k">Free space left on the disk</span><span className="v"><span className={`badge ${lowDisk ? "overdue" : "done"}`}>{mb(s.free)}</span></span></div>}
      {lowDisk && <div className="login-error" style={{ marginTop: 10 }}>The disk is nearly full. Free some space or move to the cloud server.</div>}
      {msg && <div className="note" style={{ marginTop: 10 }}>{msg}</div>}
      <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={clean}>Delete face check-in photos older than 90 days</button>
      <div className="meta" style={{ marginTop: 6 }}>Attendance records stay; only the little snapshot pictures are removed.</div>
    </div>
  );
}

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
            <div className="meta" style={{ marginBottom: 10 }}>Automatic once a day, at the time you choose below (default 6:30 pm). The last 14 are kept.</div>
            {backups.length === 0 && <div className="empty">No backups yet.</div>}
            {backups.slice(0, 6).map((b) => (
              <div className="kv" key={b.name}><span className="k">{fmt(b.at)}</span><span className="v">{size(b.bytes)}</span></div>
            ))}
          </div>
        </div>

        <BackupCopyCard onChanged={load} />
        <StorageCard />
        <EmailCard onChanged={load} />
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
