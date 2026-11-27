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
  useEffect(() => { load(); const t = setInterval(load, 20000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, [date]);
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
  const s = d.summary;
  const total = s.totalChecklists ?? s.expected ?? 0, pending = Math.max(0, total - s.submitted - s.inProgress);
  const roster = d.roster || [];
  const nSub = roster.filter((r) => r.status === "submitted").length, nOpen = roster.length - nSub;
  const rows = roster.filter((r) => (statusF === "all" || (statusF === "submitted" ? r.status === "submitted" : r.status !== "submitted"))
    && (secF === "all" || r.sections.some((x) => x.name.toLowerCase() === secF.toLowerCase() && x.done > 0))
    && (!q.trim() || (r.owners.join(" ") + " " + (r.submittedBy || "") + " " + r.roleName).toLowerCase().includes(q.trim().toLowerCase())));
  const tasksPct = s.tasksTotal ? Math.round(((s.tasksDone ?? 0) / s.tasksTotal) * 100) : 0;
  const dayLabel = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const seg = (list, val, set) => <div className="cd-seg">{list.map(([k, l, n]) => <button key={k} className={val === k ? "on" : ""} onClick={() => set(k)}>{l}{n != null && <em>{n}</em>}</button>)}</div>;

  return (
    <div className="cd">
      <div className="cd-bar-top">
        <div className="cd-date">
          <input className="field" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          {date !== todayIST() && <button className="btn btn-outline btn-sm" onClick={() => setDate(todayIST())}>Today</button>}
          <span className="cd-day">{dayLabel(date)}</span>
        </div>
        <div className="cd-tools">
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff" />
          <button className="btn btn-outline btn-sm" onClick={() => api.downloadChecklistXlsx(todayIST().slice(0, 8) + "01", todayIST())}>Excel · This month</button>
          <button className="btn btn-outline btn-sm" onClick={() => api.downloadChecklistXlsx(new Date(Date.now() + 19800000 - 90 * 86400000).toISOString().slice(0, 10), todayIST())}>Excel · 3 months</button>
        </div>
      </div>

      <div className="cd-kpis">
        <div className="cd-kpi ok"><span>Submitted</span><b>{s.submitted}</b><small>of {total} checklists</small></div>
        <div className={`cd-kpi ${pending ? "warn" : "ok"}`}><span>Pending</span><b>{pending}</b><small>not started</small></div>
        <div className="cd-kpi info"><span>In progress</span><b>{s.inProgress}</b><small>being filled</small></div>
        <div className={`cd-kpi ${s.late ? "bad" : ""}`}><span>Late</span><b>{s.late ?? 0}</b><small>submitted after 8 PM</small></div>
      </div>
      <div className="cd-strip">
        <div><span>Tasks completed</span><b>{s.tasksDone ?? 0} / {s.tasksTotal ?? 0}</b><i className="cd-mini"><u style={{ width: `${tasksPct}%` }} /></i></div>
        <div><span>Evidence photos</span><b>{s.photos}</b></div>
        <div><span>Incomplete sections</span><b>{s.incompleteSections ?? 0}</b></div>
      </div>

      <div className="cd-card">
        <div className="cd-filters">
          {seg([["all", "All", roster.length], ["submitted", "Submitted", nSub], ["pending", "Pending", nOpen]], statusF, setStatusF)}
          {seg([["all", "All sections"], ["Opening", "Opening"], ["During the Day", "During the Day"], ["End of Day", "End of Day"]], secF, setSecF)}
        </div>
        <div className="cd-scroll">
          <table className="cd-table">
            <thead><tr><th>Staff</th><th>Role</th><th>Status</th><th>Progress</th><th>Sections</th><th>Photos</th><th>Time</th><th>Submitted by</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="cd-none">No checklists match.</td></tr>}
              {rows.map((r) => (
                <React.Fragment key={r.roleName}>
                  <tr className={r.items.length ? "click" : ""} onClick={() => r.items.length && setOpen(open === r.roleName ? null : r.roleName)}>
                    <td className="cd-name">{r.owners.join(" / ") || "—"}{r.items.length ? <i className={`cd-caret ${open === r.roleName ? "up" : ""}`} /> : null}</td>
                    <td className="cd-role">{r.roleName}</td>
                    <td><span className={`cd-pill ${r.status === "submitted" ? "ok" : r.status === "in_progress" ? "info" : "warn"}`}>{r.status === "submitted" ? "Submitted" : r.status === "in_progress" ? "In progress" : "Pending"}</span></td>
                    <td>{r.pct == null ? <span className="cd-dash">—</span> : <div className="cd-prog"><i className="cd-mini"><u className={r.pct >= 90 ? "ok" : r.pct >= 60 ? "mid" : "low"} style={{ width: `${r.pct}%` }} /></i><span>{r.completed}/{r.total} · {r.pct}%</span></div>}</td>
                    <td>{r.sections.length ? <div className="cd-chips">{r.sections.map((x) => <span key={x.name} className={`cd-chip ${x.done === x.total ? "ok" : ""}`}>{x.name} {x.done}/{x.total}</span>)}</div> : <span className="cd-dash">—</span>}</td>
                    <td>{r.items.length ? r.photos : <span className="cd-dash">—</span>}</td>
                    <td>{r.time || <span className="cd-dash">—</span>}{r.late ? <span className="cd-chip bad">Late</span> : null}</td>
                    <td>{r.submittedBy ? <>{r.submittedBy}{r.coveredBy ? <small className="cd-sub">covering</small> : null}</> : <span className="cd-dash">—</span>}</td>
                  </tr>
                  {open === r.roleName && (
                    <tr className="cd-open"><td colSpan={8}>
                      <div className="cd-items">{r.items.map((i, k) => <div key={k} className={i.done ? "on" : ""}><i className="cd-tick" /><span>{i.text}</span>{i.photoUrl && <a href={assetUrl(i.photoUrl)} target="_blank" rel="noreferrer">Photo</a>}</div>)}</div>
                    </td></tr>)}
                </React.Fragment>))}
            </tbody>
          </table>
        </div>
        <div className="cd-foot">Updated {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{s.fromSheet ? ` · ${s.fromSheet} from the old Google form` : ""}</div>
      </div>

      <div className="cd-card">
        <div className="cd-head"><b>Last {d.trend.length} days</b><span>Average completion</span></div>
        <div className="cd-chart">
          <div className="cd-y"><span>100%</span><span>50%</span><span>0%</span></div>
          <div className="cd-plot">
            {d.trend.map((t) => (
              <button key={t.date} className={`cd-col ${t.date === d.date ? "on" : ""}`} title={`${dayLabel(t.date)}: ${t.submitted} submitted, ${t.avgPct ?? 0}% average`} onClick={() => setDate(t.date)}>
                <span className="cd-zone"><span className="cd-val">{t.submitted ? `${t.avgPct ?? 0}%` : ""}</span><i style={{ height: Math.max(t.submitted ? 3 : 0, (t.avgPct || 0) * 1.4) }} /></span>
                <em>{t.date.slice(8)}<small>{new Date(t.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" })}</small></em>
              </button>
            ))}
          </div>
        </div>
      </div>

      {canAssign && asg && (
        <details className="card" style={{ marginBottom: 16 }}>
          <summary className="title" style={{ cursor: "pointer" }}>Assign checklists</summary>
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
    </div>
  );
}
