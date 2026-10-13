import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import PunchCard from "../components/PunchCard.jsx";
import FinesPanel from "../components/FinesPanel.jsx";

const fmtTime = (t) => (t ? new Date(t.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

export default function AttendancePage({ user, onLogout, onBack }) {
  const [date, setDate] = useState(todayIST());
  const [board, setBoard] = useState(null);
  const [month, setMonth] = useState(null);
  const [tab, setTab] = useState("day");
  const [reg, setReg] = useState(null);
  const [preset, setPreset] = useState(null);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = () => {
    api.attendanceBoard(date).then(setBoard).catch(() => setBoard({ rows: [], present: 0, total: 0 }));
    api.attendanceRegister(date.slice(0, 7)).then(setReg).catch(() => setReg({ rows: [], daysInMonth: 0 }));
    api.attendanceMonth(date.slice(0, 7)).then(setMonth).catch(() => setMonth({ rows: [] }));
  };
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [date]);

  async function manual(userId, type) {
    try { await api.manualAttendance(userId, type); flash("Saved (marked as manual entry)."); load(); } catch (e) { flash(e.message); }
  }
  function fineFor(r) { setPreset({ userId: r.id, category: "late", amount: 100, date, note: r.first_in ? `First in ${fmtTime(r.first_in)}` : "" }); setTab("fines"); }
  function downloadRegister() {
    if (!reg) return;
    const head = ["Staff", "Department", ...Array.from({ length: reg.daysInMonth }, (_, i) => i + 1), "Present", "Late", "Absent", "Fines (Rs)"];
    const lines = [head, ...reg.rows.map((r) => [r.name, r.department || "", ...r.days, r.present, r.late, r.absent, r.fine_total])];
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `attendance-register-${reg.month}.csv`; a.click();
  }
  const statusBadge = { in: ["done", "In clinic"], out: ["accepted", "Checked out"], absent: ["overdue", "Not in yet"] };

  return (
    <PageShell user={user} active="Attendance" title="Attendance" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div>
          <div className="eyebrow">People</div>
          <h1>Attendance</h1>
          <p>Everyone's check-in and check-out, live. Staff just tap one button on their phone — no fingerprint set-up needed.</p>
        </div>
        <input className="field" type="date" style={{ width: 180 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
      </div>

      <PunchCard />

      <div className="pill-row">
        <button className={`pill ${tab === "day" ? "active" : ""}`} onClick={() => setTab("day")}>Day view {board && <span className="n">{board.present}/{board.total}</span>}</button>
        <button className={`pill ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>Register (sheet)</button>
        <button className={`pill ${tab === "fines" ? "active" : ""}`} onClick={() => setTab("fines")}>Fines</button>
        <button className={`pill ${tab === "month" ? "active" : ""}`} onClick={() => setTab("month")}>Month summary</button>
      </div>

      {tab === "day" && (!board ? <div className="empty">Loading…</div> : (
        <div className="card">
          {board.rows.map((r) => {
            const [cls, label] = statusBadge[r.status];
            return (
              <div key={r.id} className="task-row">
                <div>
                  <div className="title">{r.name}</div>
                  <div className="meta">{r.department || "—"} · In {fmtTime(r.first_in)} · Out {fmtTime(r.last_out)}{r.hours ? ` · ${r.hours} h` : ""}{r.methods.includes("manual") ? " · manual entry" : ""}</div>
                </div>
                <div className="right" style={{ gap: 8 }}>
                  {r.late && <span className="badge overdue">Late</span>}
                  <span className={`badge ${cls}`}>{label}</span>
                  {r.late && <button className="btn btn-ghost btn-sm" onClick={() => fineFor(r)}>Add fine</button>}
                  {date === todayIST() && (r.status === "in"
                    ? <button className="btn btn-ghost btn-sm" onClick={() => manual(r.id, "check_out")}>Mark out</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => manual(r.id, "check_in")}>Mark in</button>)}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {tab === "register" && (!reg ? <div className="empty">Loading…</div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="meta">P = present · L = late (after {board?.late_after || "10:00"}) · A = absent · W = Sunday off</div>
            <button className="btn btn-ghost btn-sm" onClick={downloadRegister}>Download (Excel/CSV)</button>
          </div>
          <table className="reg-table">
            <thead><tr><th>Staff</th>{Array.from({ length: reg.daysInMonth }, (_, i) => <th key={i}>{i + 1}</th>)}<th>P</th><th>Late</th><th>Abs</th><th>Fines</th></tr></thead>
            <tbody>{reg.rows.map((r) => (
              <tr key={r.id}><td className="nm">{r.name}<div className="meta">{r.department}</div></td>
                {r.days.map((d, i) => <td key={i} className={`c-${d || "x"}`}>{d}</td>)}
                <td><b>{r.present}</b></td><td>{r.late}</td><td>{r.absent}</td><td>{r.fine_total ? "₹" + r.fine_total : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {tab === "fines" && <FinesPanel month={date.slice(0, 7)} isAdmin={user.role === "admin"} preset={preset} onChanged={load} />}

      {tab === "month" && (!month ? <div className="empty">Loading…</div> : (
        <div className="card">
          <div className="meta" style={{ marginBottom: 8 }}>Days present in {month.month}</div>
          {month.rows.map((r) => (
            <div key={r.id} className="task-row">
              <div><div className="title">{r.name}</div><div className="meta">{r.department || "—"}</div></div>
              <span className="badge accepted">{r.days_present} day{r.days_present === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      ))}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}
