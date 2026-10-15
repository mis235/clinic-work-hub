import { useEffect, useState } from "react";
import { api, assetUrl } from "../api.js";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const tone = (p) => (p == null ? "" : p >= 90 ? "done" : p >= 60 ? "accepted" : "overdue");

// ONE checklist dashboard: checklists filled in the app and checklists that came from the old Google form/sheet, together.
export default function ChecklistDashboard({ user }) {
  const [date, setDate] = useState(todayIST());
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === "admin";

  const load = () => api.checklistDashboard(date, 14).then((r) => { setD(r); setErr(""); }).catch((e) => setErr(e.message));
  const loadSheet = () => api.checklistSheet().then((r) => { setSheet(r); setUrl(r.url === "set" ? "" : r.url || ""); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [date]);
  useEffect(() => { loadSheet(); }, []);

  async function saveSheet() { setBusy(true); setMsg(""); try { await api.saveChecklistSheet(url); setMsg("Link saved."); loadSheet(); } catch (e) { setMsg(e.message); } setBusy(false); }
  async function syncNow() {
    setBusy(true); setMsg("");
    try { const r = await api.syncChecklistSheet(); setMsg(`Synced: ${r.imported} new or updated entr${r.imported === 1 ? "y" : "ies"} from the sheet${r.unmatched?.length ? `; names not matched to staff: ${r.unmatched.map((u) => u.name).join(", ")}` : ""}.`); load(); loadSheet(); }
    catch (e) { setMsg(e.message); loadSheet(); }
    setBusy(false);
  }

  if (err && !d) return <div className="empty">{err}</div>;
  if (!d) return <div className="empty">Loading…</div>;
  const s = d.summary, max = 100;
  const st = sheet?.status;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div className="meta">Everything staff submit — in this app or through the old Google form — appears here together. Refreshes by itself.</div>
        <input className="field" type="date" style={{ width: 170 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="dept-grid tile-grid">
        {[["Submitted", `${s.submitted}/${s.expected}`], ["In progress", s.inProgress], ["Not started", s.notStarted], ["Average done", s.avgPct == null ? "—" : s.avgPct + "%"], ["Task photos", s.photos], ["From old form", s.fromSheet]].map(([l, v]) => (
          <div key={l} className="dept-card"><div className="meta">{l}</div><div className="title" style={{ fontSize: 24 }}>{v}</div></div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="title" style={{ marginBottom: 8 }}>Last {d.trend.length} days — checklists submitted and average completion</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
          {d.trend.map((t) => (
            <div key={t.date} title={`${t.date}: ${t.submitted} submitted, ${t.avgPct ?? 0}% done`} onClick={() => setDate(t.date)} style={{ flex: 1, cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
              <div style={{ background: t.date === d.date ? "var(--primary-dark, #0b5c55)" : "var(--primary)", borderRadius: 4, height: `${((t.avgPct || 0) / max) * 100}%`, minHeight: t.submitted ? 3 : 0 }} />
              <div className="meta" style={{ fontSize: 9.5, textAlign: "center", marginTop: 3 }}>{t.date.slice(8)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>By role (last {d.trend.length} days)</div>
          {d.byRole.length === 0 && <div className="empty">No submissions yet.</div>}
          {d.byRole.map((r) => (
            <div key={r.role} className="task-row"><div><div className="title">{r.role}</div><div className="meta">{r.submissions} submission{r.submissions === 1 ? "" : "s"}</div></div><span className={`badge ${tone(r.avgPct)}`}>{r.avgPct}%</span></div>
          ))}
        </div>
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>Tasks most often left undone</div>
          {d.missedMost.length === 0 && <div className="empty">Nothing missed. Great.</div>}
          {d.missedMost.map((m, i) => (
            <div key={i} className="task-row"><div><div className="title" style={{ fontWeight: 600 }}>{m.task}</div><div className="meta">{m.role}</div></div><span className="badge overdue">{m.times}×</span></div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>Checklists on {d.date}</div>
        {d.people.length === 0 && <div className="empty">No checklists yet for this day.</div>}
        {d.people.map((p) => (
          <div key={p.id}>
            <div className="task-row" style={{ cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <div><div className="title">{p.staffName} <span className="meta">· {p.roleName} · {p.shift}</span></div>
                <div className="meta">{p.status === "submitted" ? "Submitted" : "In progress"}{p.photos ? ` · ${p.photos} photo${p.photos === 1 ? "" : "s"}` : ""} · {p.source === "sheet" ? "via old form" : "in the app"}</div></div>
              <span className={`badge ${tone(p.completionPct)}`}>{p.completed}/{p.total} · {p.completionPct}%</span>
            </div>
            {open === p.id && (
              <div style={{ padding: "6px 6px 14px 14px" }}>
                {p.items.map((i, k) => (
                  <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 13 }}>
                    <span>{i.done ? "✅" : "⬜"}</span><span style={{ flex: 1, opacity: i.done ? 1 : 0.7 }}>{i.text}</span>
                    {i.photoUrl && <a href={assetUrl(i.photoUrl)} target="_blank" rel="noreferrer"><img alt="" src={assetUrl(i.photoUrl)} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} /></a>}
                  </div>
                ))}
                {p.photoUrl && <a href={assetUrl(p.photoUrl)} target="_blank" rel="noreferrer"><img alt="Evidence" src={assetUrl(p.photoUrl)} style={{ maxWidth: 160, borderRadius: 12, marginTop: 8 }} /></a>}
              </div>
            )}
          </div>
        ))}
        {d.missing.length > 0 && <div className="meta" style={{ paddingTop: 12, borderTop: "1px solid var(--line)", marginTop: 8 }}><b>{d.missing.length}</b> not started: {d.missing.map((m) => m.name).join(", ")}</div>}
      </div>

      {isAdmin && (
        <div className="card">
          <div className="title">Keep the old Google form in step (optional)</div>
          <p className="meta" style={{ margin: "6px 0" }}>If staff still fill the old Google form, paste the log sheet's link here and the app reads it every 10 minutes. Easiest way: open the sheet → press <b>Share</b> → General access → <b>Anyone with the link → Viewer</b> → copy the normal link and paste it here. (Or File → Share → Publish to web → CSV.) A private sheet cannot be read.</p>
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveSheet}>Save link</button>
            <button className="btn btn-outline btn-sm" disabled={busy || !sheet?.url} onClick={syncNow}>{busy ? "Working…" : "Sync now"}</button>
          </div>
          {st && <div className="meta" style={{ marginTop: 8 }}>Last check: {new Date(st.at).toLocaleString("en-IN")} — {st.ok ? `OK (${st.rows} rows read)` : <span style={{ color: "var(--red)" }}>{st.error}</span>}</div>}
          {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
          <div className="meta" style={{ marginTop: 8 }}>No link? Download the sheet as CSV and use <b>System &amp; Backups → Import checklist history</b> instead. If your Google Workspace blocks “Publish to web”, ask its admin to allow it.</div>
        </div>
      )}
    </>
  );
}
