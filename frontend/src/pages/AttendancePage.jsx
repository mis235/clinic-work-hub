import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import FinesPanel from "../components/FinesPanel.jsx";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const MARKS = [["P", "Present", "done"], ["L", "Late", "overdue"], ["H", "Half day", "accepted"], ["LV", "Leave", "accepted"], ["A", "Absent", "overdue"], ["W", "Off", "accepted"]];
const CYCLE = ["", "P", "L", "A", "H", "LV", "W"];

// Attendance is marked by the admin / manager (like the paper register). Staff do not check in on the app.
export default function AttendancePage({ user, onLogout, onBack }) {
  const [date, setDate] = useState(todayIST());
  const [board, setBoard] = useState(null);
  const [reg, setReg] = useState(null);
  const [tab, setTab] = useState("day");
  const [preset, setPreset] = useState(null);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  const month = date.slice(0, 7);

  const load = () => {
    api.attendanceBoard(date).then(setBoard).catch((e) => { setBoard({ rows: [], counts: {}, total: 0 }); flash(e.message); });
    api.attendanceRegister(month).then(setReg).catch(() => setReg({ rows: [], daysInMonth: 0 }));
  };
  useEffect(load, [date]);

  async function mark(userId, d, status) {
    try { await api.markAttendance(userId, d, status); load(); } catch (e) { flash(e.message); }
  }
  async function markAll(status) {
    try { const r = await api.markAttendanceDay(date, status); flash(`${r.marked} people marked.`); load(); } catch (e) { flash(e.message); }
  }
  function download() {
    if (!reg) return;
    const head = ["Staff", "Department", ...Array.from({ length: reg.daysInMonth }, (_, i) => i + 1), "Present", "Late", "Absent", "Leave", "Fines (Rs)"];
    const lines = [head, ...reg.rows.map((r) => [r.name, r.department || "", ...r.days, r.present, r.late, r.absent, r.leave, r.fine_total])];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `attendance-register-${reg.month}.csv`; a.click();
  }
  const c = board?.counts || {};

  return (
    <PageShell user={user} active="Attendance" title="Attendance" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">People</div><h1>Attendance</h1>
          <p>Mark the day's attendance here (like the paper register). Staff do not need to check in on the app.</p></div>
        <input className="field" type="date" style={{ width: 180 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="dept-grid tile-grid">
        {[["Present", c.P, "green"], ["Late", c.L], ["Half day", c.H], ["On leave", c.LV], ["Absent", c.A], ["Not marked", c.unmarked]].map(([l, n]) => (
          <div key={l} className="dept-card"><div className="meta">{l}</div><div className="title" style={{ fontSize: 24 }}>{n ?? 0}</div></div>
        ))}
      </div>

      <div className="pill-row">
        <button className={`pill ${tab === "day" ? "active" : ""}`} onClick={() => setTab("day")}>Mark the day</button>
        <button className={`pill ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>Month register</button>
        <button className={`pill ${tab === "fines" ? "active" : ""}`} onClick={() => setTab("fines")}>Fines</button>
      </div>

      {tab === "day" && (!board ? <div className="empty">Loading…</div> : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div className="meta">Tap a status for each person. “Mark all present” fills only the people not yet marked.</div>
            <button className="btn btn-outline btn-sm" onClick={() => markAll("P")}>Mark all present</button>
          </div>
          {board.rows.map((r) => (
            <div key={r.id} className="task-row" style={{ flexWrap: "wrap", gap: 8 }}>
              <div><div className="title">{r.name}</div><div className="meta">{r.department || "—"}{r.designation ? ` · ${r.designation}` : ""}</div></div>
              <div className="right" style={{ gap: 4, flexWrap: "wrap" }}>
                {MARKS.map(([k, label]) => (
                  <button key={k} className={`pill ${r.mark === k ? "active" : ""}`} style={{ padding: "5px 10px" }} onClick={() => mark(r.id, date, r.mark === k ? "" : k)}>{label}</button>
                ))}
                {r.mark === "L" && <button className="btn btn-ghost btn-sm" onClick={() => { setPreset({ userId: r.id, category: "late", amount: 100, date, note: "" }); setTab("fines"); }}>Add fine</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === "register" && (!reg ? <div className="empty">Loading…</div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div className="meta">Click a box to change it: P present · L late · A absent · H half day · LV leave · W off. Month: {reg.month}</div>
            <button className="btn btn-ghost btn-sm" onClick={download}>Download (Excel/CSV)</button>
          </div>
          <table className="reg-table">
            <thead><tr><th>Staff</th>{Array.from({ length: reg.daysInMonth }, (_, i) => <th key={i}>{i + 1}</th>)}<th>Pres</th><th>Late</th><th>Abs</th><th>Leave</th><th>Fines</th></tr></thead>
            <tbody>{reg.rows.map((r) => (
              <tr key={r.id}><td className="nm">{r.name}<div className="meta">{r.department}</div></td>
                {r.days.map((d, i) => {
                  const day = `${reg.month}-${String(i + 1).padStart(2, "0")}`;
                  const future = day > todayIST();
                  return <td key={i} className={`c-${d || "x"} ${future ? "" : "clk"}`} onClick={() => !future && mark(r.id, day, CYCLE[(CYCLE.indexOf(d) + 1) % CYCLE.length])}>{d === "LV" ? "Lv" : d}</td>;
                })}
                <td><b>{r.present}</b></td><td>{r.late || ""}</td><td>{r.absent || ""}</td><td>{r.leave || ""}</td><td>{r.fine_total ? "₹" + r.fine_total : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {tab === "fines" && <FinesPanel month={month} isAdmin={user.role === "admin"} preset={preset} onChanged={load} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}
