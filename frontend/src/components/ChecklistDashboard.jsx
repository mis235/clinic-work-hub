import React, { useEffect, useState } from "react";
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
  const canAssign = isAdmin || !!user.isHr;
  const [q, setQ] = useState(""); const [statusF, setStatusF] = useState("all"); const [secF, setSecF] = useState("all");
  const [asg, setAsg] = useState(null);
  useEffect(() => { if (canAssign) api.checklistAssignments().then(setAsg).catch(() => {}); }, []);
  async function toggleAssign(roleName, uid, current) {
    const next = current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid];
    await api.saveChecklistAssignment(roleName, next).catch((e) => setMsg(e.message));
    api.checklistAssignments().then(setAsg).catch(() => {}); load();
  }
  const [push, setPush] = useState(null); const [pushUrl, setPushUrl] = useState(""); const [pushKey, setPushKey] = useState("");
  const loadPush = () => isAdmin && api.checklistPush().then((r) => { setPush(r); setPushUrl(r.url || ""); }).catch(() => {});
  useEffect(() => { loadPush(); }, []);
  async function savePush() { setBusy(true); setMsg(""); try { await api.saveChecklistPush(pushUrl, pushKey || undefined); setMsg("Saved."); loadPush(); } catch (e) { setMsg(e.message); } setBusy(false); }
  async function testPush() { setBusy(true); setMsg(""); try { await api.testChecklistPush(); setMsg("Test row sent. Look at the bottom of your Google Sheet."); } catch (e) { setMsg(e.message); } loadPush(); setBusy(false); }

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
        <div className="meta">Live checklist progress. Refreshes by itself.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="field" type="date" style={{ width: 170 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={() => api.downloadChecklistXlsx(todayIST().slice(0, 8) + "01", todayIST())}>Excel · this month</button>
          <button className="btn btn-outline btn-sm" onClick={() => api.downloadChecklistXlsx(new Date(Date.now() + 19800000 - 90 * 86400000).toISOString().slice(0, 10), todayIST())}>Excel · 3 months</button>
        </div>
      </div>

      <div className="meta" style={{ marginBottom: 6 }}>Search staff</div>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name…" style={{ maxWidth: 520, marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <div><div className="meta">Status</div><div className="pill-row">{[["all", "All"], ["submitted", "Submitted"], ["pending", "Pending"]].map(([k, l]) => <button key={k} className={`pill ${statusF === k ? "active" : ""}`} onClick={() => setStatusF(k)}>{l}</button>)}</div></div>
        <div><div className="meta">Section touched</div><div className="pill-row">{[["all", "All"], ["Opening", "Opening"], ["During the Day", "During the Day"], ["End of Day", "End of Day"]].map(([k, l]) => <button key={k} className={`pill ${secF === k ? "active" : ""}`} onClick={() => setSecF(k)}>{l}</button>)}</div></div>
      </div>

      <div className="dept-grid tile-grid">
        {[["Total checklists", s.totalChecklists ?? s.expected], ["Submitted today", s.submitted], ["Pending", Math.max(0, (s.totalChecklists ?? s.expected) - s.submitted - s.inProgress)], ["In progress", s.inProgress],
          ["Tasks completed (clinic-wide)", `${s.tasksDone ?? 0} / ${s.tasksTotal ?? 0}`], ["Evidence photos", s.photos], ["Incomplete sections", s.incompleteSections ?? 0], ["Late submissions (after 8 PM)", s.late ?? 0]].map(([l, v]) => (
          <div key={l} className="dept-card"><div className="meta">{l}</div><div className="title" style={{ fontSize: 24 }}>{v}</div></div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <table className="reg-table" style={{ width: "100%", minWidth: 760 }}>
          <thead><tr><th>Staff</th><th>Role</th><th>Status</th><th>Done</th><th>Total</th><th>Completion</th><th>Sections touched</th><th>Photos</th><th>Time</th><th>Submitted by</th></tr></thead>
          <tbody>
            {(d.roster || []).filter((r) => (statusF === "all" || (statusF === "submitted" ? r.status === "submitted" : r.status !== "submitted"))
              && (secF === "all" || r.sections.some((x) => x.name.toLowerCase() === secF.toLowerCase() && x.done > 0))
              && (!q.trim() || (r.owners.join(" ") + " " + (r.submittedBy || "") + " " + r.roleName).toLowerCase().includes(q.trim().toLowerCase()))).map((r) => (
              <React.Fragment key={r.roleName}>
                <tr style={{ cursor: r.items.length ? "pointer" : "default" }} onClick={() => r.items.length && setOpen(open === r.roleName ? null : r.roleName)}>
                  <td><b>{r.owners.join(" / ") || "—"}</b>{r.items.length ? " ▾" : ""}</td>
                  <td>{r.roleName}</td>
                  <td><span className={`badge ${r.status === "submitted" ? "done" : r.status === "in_progress" ? "progress" : "overdue"}`}>{r.status === "submitted" ? "✓ Submitted" : r.status === "in_progress" ? "In progress" : "⏳ Pending"}</span></td>
                  <td>{r.completed ?? "—"}</td><td>{r.total ?? "—"}</td>
                  <td>{r.pct == null ? "—" : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 70, height: 7, background: "var(--line)", borderRadius: 4, overflow: "hidden", display: "inline-block" }}><span style={{ display: "block", height: "100%", width: `${r.pct}%`, background: "var(--primary)" }} /></span>{r.pct}%</span>}</td>
                  <td>{r.sections.length ? r.sections.map((x) => <div key={x.name} className="meta" style={{ whiteSpace: "nowrap" }}>{x.done === x.total ? "✓" : "•"} {x.name} ({x.done}/{x.total})</div>) : "—"}</td>
                  <td>{r.items.length ? r.photos : "—"}</td>
                  <td>{r.time || "—"}{r.late ? " ⚠" : ""}</td>
                  <td>{r.submittedBy ? <>{r.submittedBy}{r.coveredBy ? <div className="meta">covering</div> : null}</> : "—"}</td>
                </tr>
                {open === r.roleName && (
                  <tr><td colSpan={10} style={{ background: "var(--bg, #fafafa)" }}>
                    {r.items.map((i, k) => <div key={k} style={{ fontSize: 13, padding: "2px 0" }}>{i.done ? "✅" : "⬜"} <span style={{ opacity: i.done ? 1 : 0.7 }}>{i.text}</span>{i.photoUrl && <a href={assetUrl(i.photoUrl)} target="_blank" rel="noreferrer"> 📷</a>}</div>)}
                  </td></tr>)}
              </React.Fragment>))}
          </tbody>
        </table>
        <div className="meta" style={{ marginTop: 8 }}>Last loaded {new Date().toLocaleTimeString("en-IN")} · refreshes every 30 seconds{s.fromSheet ? ` · ${s.fromSheet} from the old Google form` : ""}</div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="title">Recent Updates</div>
          {sheet?.status && <div className="meta" style={{ margin: "4px 0 8px" }}>Google Sheet last checked {new Date(sheet.status.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} — {sheet.status.ok ? `${sheet.status.rows} rows read` : "could not be read"}{sheet.status.unmatchedNames?.length ? `. Names not matched: ${sheet.status.unmatchedNames.join(", ")}` : ""}</div>}
          {(d.recent || []).length === 0 && <div className="empty">No updates yet.</div>}
          {(d.recent || []).map((r, i) => (
            <div key={i} className="task-row"><div><b>{r.staffName}</b> <span className="meta">· {r.roleName} · {r.shift} · {r.date}</span></div>
              <div className="meta">{r.completed}/{r.total} tasks · {r.pct}% · {r.source === "sheet" ? "Google Form" : "App"}</div></div>))}
        </div>
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

      {canAssign && asg && (
        <details className="card" style={{ marginBottom: 16 }}>
          <summary className="title" style={{ cursor: "pointer" }}>⚙ Admin: choose who fills each checklist</summary>
          <p className="meta" style={{ margin: "6px 0 10px" }}>Tap a checklist name, then tick the people who should fill it.</p>
          {asg.roles.map((r) => (
            <details key={r.roleName} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <summary style={{ cursor: "pointer" }}><b>{r.roleName}</b> <span className="meta">— {[...new Set([...r.own, ...r.assigned])].map((id) => asg.staff.find((x) => x.id === id)?.name).filter(Boolean).join(", ") || "nobody yet"}</span></summary>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 0" }}>
                {asg.staff.map((u) => (
                  <label key={u.id} className="pill" style={{ cursor: r.own.includes(u.id) ? "default" : "pointer", opacity: r.own.includes(u.id) ? 0.6 : 1 }}>
                    <input type="checkbox" checked={r.own.includes(u.id) || r.assigned.includes(u.id)} disabled={r.own.includes(u.id)} onChange={() => toggleAssign(r.roleName, u.id, r.assigned)} /> {u.name}{r.own.includes(u.id) ? " (main)" : ""}
                  </label>))}
              </div>
            </details>))}
        </details>)}
    </>
  );
}
