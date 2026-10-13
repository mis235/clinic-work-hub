import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import FinesPanel from "../components/FinesPanel.jsx";
import FaceEnrollModal from "../components/FaceEnrollModal.jsx";
import { snapUrl } from "../api.js";

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
        <button className={`pill ${tab === "face" ? "active" : ""}`} onClick={() => setTab("face")}>Face check-in</button>
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

      {tab === "face" && <FacePanel date={date} people={board?.rows || []} isAdmin={user.role === "admin"} flash={flash} />}
      {tab === "fines" && <FinesPanel month={month} isAdmin={user.role === "admin"} preset={preset} onChanged={load} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function FacePanel({ date, people, isAdmin, flash }) {
  const [enrolled, setEnrolled] = useState({});
  const [log, setLog] = useState([]);
  const [devices, setDevices] = useState([]);
  const [link, setLink] = useState("");
  const [enrolling, setEnrolling] = useState(null);
  const load = () => {
    if (isAdmin) { api.enrolledFaces().then((r) => setEnrolled(Object.fromEntries(r.map((x) => [x.user_id, true])))).catch(() => {}); api.kioskDevices().then(setDevices).catch(() => {}); }
    api.kioskLog(date).then(setLog).catch(() => setLog([]));
  };
  useEffect(load, [date]);
  async function newPhone() {
    try { const d = await api.createKioskDevice("Clinic phone"); setLink(`${window.location.origin}/kiosk#key=${encodeURIComponent(d.key)}`); load(); } catch (e) { flash(e.message); }
  }
  const secure = window.isSecureContext;
  return (
    <>
      <div className="card">
        <div className="title">How it works</div>
        <p className="meta" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>Register each person's face once. Then leave the clinic phone open on the check-in screen: when someone looks at the camera they are recognised and marked <b>Present</b> (or <b>Late</b> after {"10:30 AM"}). Their picture at that moment is saved for you to review below.</p>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="title">Setting up the clinic phone</div>
          <ol className="meta" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            <li>Press <b>Create phone link</b>, then open that link once in Chrome on the clinic phone. It saves itself and shows the check-in screen.</li>
            <li>Allow the camera when asked. Keep the phone propped up with the screen on.</li>
            <li><b>Important:</b> phone cameras only work on secure (https) addresses. If the app runs on a PC in the clinic, either put the app online with https, or on the phone open <code>chrome://flags</code>, search “Insecure origins treated as secure”, add the app address, and relaunch.</li>
          </ol>
          <button className="btn btn-primary btn-sm" onClick={newPhone}>Create phone link</button>
          {!secure && <span className="meta" style={{ marginLeft: 10 }}>(This computer is on http — registering faces works here only at localhost.)</span>}
          {link && <div style={{ marginTop: 10 }}><input className="field" readOnly value={link} onFocus={(e) => e.target.select()} /><div className="meta">Open this link on the clinic phone. Keep it private — anyone with it can use the check-in screen.</div></div>}
          {devices.filter((d) => !d.revoked_at).map((d) => (
            <div key={d.id} className="task-row"><div><div className="title">{d.label}</div><div className="meta">Set up {d.created_at?.slice(0, 10)} · last used {d.last_seen ? d.last_seen.replace("T", " ").slice(0, 16) + " UTC" : "never"}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={async () => { await api.revokeKioskDevice(d.id); load(); }}>Switch off</button></div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>Registered faces</div>
          {people.map((p) => (
            <div key={p.id} className="task-row">
              <div><div className="title">{p.name}</div><div className="meta">{p.department}</div></div>
              <div className="right" style={{ gap: 8 }}>
                <span className={`badge ${enrolled[p.id] ? "done" : "sent"}`}>{enrolled[p.id] ? "Registered" : "Not registered"}</span>
                <button className="btn btn-outline btn-sm" onClick={() => setEnrolling(p)}>{enrolled[p.id] ? "Re-do" : "Register face"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>Face check-ins on {date}</div>
        {log.length === 0 && <div className="empty">No face check-ins yet.</div>}
        {log.map((l) => (
          <div key={l.id} className="task-row">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {l.has_snap && <img alt="" src={snapUrl(l.id)} style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />}
              <div><div className="title">{l.name}</div><div className="meta">{new Date(l.created_at.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · match {Math.round((1 - l.distance) * 100)}%</div></div>
            </div>
            <span className={`badge ${l.mark === "P" ? "done" : "overdue"}`}>{l.mark === "P" ? "Present" : "Late"}</span>
          </div>
        ))}
      </div>
      {enrolling && <FaceEnrollModal person={enrolling} onClose={() => setEnrolling(null)} onDone={(m) => { setEnrolling(null); flash(m); load(); }} />}
    </>
  );
}
