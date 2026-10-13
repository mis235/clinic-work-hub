import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const short = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });

// Who works which shift, week by week. Late fines/flags on the Attendance page use these start times.
export default function RosterPage({ user, onLogout, onBack }) {
  const [start, setStart] = useState(todayIST());
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => api.rosterWeek(start).then(setData).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [start]);
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  async function set(userId, date, shift) {
    try { await api.setShift(userId, date, shift); load(); } catch (e) { flash(e.message); }
  }
  async function copyPrev() {
    try { const r = await api.copyWeek(addDays(data.start, -7), data.start); flash(`Copied ${r.copied} shifts from last week.`); load(); } catch (e) { flash(e.message); }
  }
  const types = data?.types || {};
  const [panel, setPanel] = useState(false);
  const [nw, setNw] = useState({ start: "09:00", end: "18:30", label: "" });
  async function addType(e) {
    e.preventDefault();
    try { await api.addShiftType(nw); setNw({ start: "09:00", end: "18:30", label: "" }); flash("Shift added."); load(); } catch (er) { flash(er.message); }
  }
  async function delType(k) { if (!confirm("Remove this shift?")) return; try { await api.deleteShiftType(k); load(); } catch (er) { flash(er.message); } }
  async function weekFor(r, shift) {
    if (!shift) return;
    const dates = data.days.slice(0, 6); // Mon-Sat; Sunday stays free
    try { await api.setShiftBulk(r.id, dates, shift === "clear" ? "" : shift); await api.setShift(r.id, data.days[6], shift === "clear" ? "" : "off"); load(); } catch (er) { flash(er.message); }
  }

  return (
    <PageShell user={user} active="Roster" title="Shift roster" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">People</div><h1>Shift roster</h1>
          <p>Choose each person's shift for the week. Staff see their own shift on their home screen, and "late" is counted from the shift start.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setStart(addDays(data?.start || start, -7))}>← Last week</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setStart(addDays(data?.start || start, 7))}>Next week →</button>
          <button className="btn btn-outline btn-sm" onClick={copyPrev}>Copy last week</button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="meta">Shifts: {Object.values(types).filter((t) => t.start).map((t) => t.label).join("  ·  ") || "none yet"}</div>
        {user.role === "admin" && <button className="btn btn-outline btn-sm" onClick={() => setPanel((x) => !x)}>{panel ? "Close" : "Manage shifts"}</button>}
      </div>
      {panel && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="title" style={{ marginBottom: 6 }}>Your shifts</div>
          {Object.entries(types).filter(([, t]) => t.start).map(([k, t]) => (
            <div key={k} className="task-row"><div className="title">{t.label}</div><button className="btn btn-ghost btn-sm" onClick={() => delType(k)}>Remove</button></div>
          ))}
          <form onSubmit={addType} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <label className="meta">Starts</label><input className="field" type="time" style={{ width: 130 }} value={nw.start} onChange={(e) => setNw({ ...nw, start: e.target.value })} required />
            <label className="meta">Ends</label><input className="field" type="time" style={{ width: 130 }} value={nw.end} onChange={(e) => setNw({ ...nw, end: e.target.value })} required />
            <input className="field" style={{ width: 170 }} placeholder="Name (optional)" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} />
            <button className="btn btn-primary btn-sm" type="submit">Add shift</button>
          </form>
        </div>
      )}
      {!data ? <div className="empty">{msg || "Loading…"}</div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="reg-table">
            <thead><tr><th>Staff</th><th>Whole week</th>{data.days.map((d) => <th key={d}>{short(d)}</th>)}</tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}>
                <td className="nm">{r.name}<div className="meta">{r.department}</div></td>
                <td><select className="shift-sel" value="" onChange={(e) => weekFor(r, e.target.value)}>
                  <option value="">Set…</option>
                  {Object.entries(types).filter(([, t]) => t.start).map(([k, t]) => <option key={k} value={k}>{t.label} (Mon–Sat)</option>)}
                  <option value="clear">Clear week</option>
                </select></td>
                {r.shifts.map((sh, i) => (
                  <td key={i}>
                    <select className={`shift-sel ${sh === "off" ? "s-off" : sh ? "s-set" : ""}`} value={sh} onChange={(e) => set(r.id, data.days[i], e.target.value)}>
                      <option value="">—</option>
                      {Object.entries(types).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                    </select>
                  </td>
                ))}
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {msg && data && <div className="toast">{msg}</div>}
    </PageShell>
  );
}
