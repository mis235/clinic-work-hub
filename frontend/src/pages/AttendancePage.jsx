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
  const [dlBusy, setDlBusy] = useState(false);
  const monthsAgo = (n) => { const d = new Date(Date.now() + 19800000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
  const [expFrom, setExpFrom] = useState(""), [expTo, setExpTo] = useState("");
  async function download(from, to) { setDlBusy(true); try { await api.downloadAttendanceXlsx(from || month, to || from || month); } catch (e) { flash(e.message); } setDlBusy(false); }
  const c = board?.counts || {};

  return (
    <PageShell user={user} active="Attendance" title="Attendance" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">People</div><h1>Attendance</h1>
          <p>Mark the day's attendance here (like the paper register). Staff do not need to check in on the app.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn btn-outline btn-sm" disabled={dlBusy} onClick={download}>{dlBusy ? "Preparing…" : "⬇ Attendance sheet (Excel)"}</button><input className="field" type="date" style={{ width: 180 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></div>
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
              <div><div className="title">{r.name}</div><div className="meta">{r.department || "—"}{r.designation ? ` · ${r.designation}` : ""}{r.in_time ? ` · In ${r.in_time}` : ""}{r.out_time ? ` · Out ${r.out_time}` : ""}</div></div>
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
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-outline btn-sm" disabled={dlBusy} onClick={() => download(month, month)}>{dlBusy ? "Preparing…" : "⬇ This month (Excel)"}</button>
              <button className="btn btn-outline btn-sm" disabled={dlBusy} onClick={() => download(monthsAgo(2), monthsAgo(0))}>⬇ Last 3 months</button>
              <span className="meta">or from</span>
              <input className="field" type="month" style={{ width: 150 }} value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
              <span className="meta">to</span>
              <input className="field" type="month" style={{ width: 150 }} value={expTo} onChange={(e) => setExpTo(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={dlBusy || !expFrom} onClick={() => download(expFrom, expTo || expFrom)}>⬇ Download</button>
            </div>
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
  const [lan, setLan] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const load = () => {
    if (isAdmin) { api.enrolledFaces().then((r) => setEnrolled(Object.fromEntries(r.map((x) => [x.user_id, x])))).catch(() => {}); api.kioskDevices().then(setDevices).catch(() => {}); api.kioskLan().then(setLan).catch(() => {}); }
    api.kioskLog(date).then(setLog).catch(() => setLog([]));
  };
  useEffect(load, [date]);
  async function newPhone() {
    try { const d = await api.createKioskDevice("Clinic phone"); const host = window.location.hostname;
      const phoneReachable = host !== "localhost" && host !== "127.0.0.1";
      const ip = lan?.addresses?.[0];
      let origin = window.location.origin;
      if (!phoneReachable && lan?.tunnelUrl) origin = lan.tunnelUrl;
      else if (!phoneReachable && ip) origin = lan.httpsPort ? `https://${ip}:${lan.httpsPort}` : `http://${ip}:${lan.httpPort}`;
      setLink(`${origin}/kiosk#key=${encodeURIComponent(d.key)}`); load(); } catch (e) { flash(e.message); }
  }
  const secure = window.isSecureContext;
  return (
    <>
      <div className="card">
        <div className="title">How it works</div>
        <p className="meta" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>Register each person's face once. Leave the clinic phone open on the check-in screen. The <b>first</b> time someone looks at the camera each day is their <b>login</b> (marked Present, or Late after 10:30 AM). Looking again later (at least 30 minutes after) records their <b>logout</b>. One face can belong to only one person. A picture of each check-in is saved below for you to review.</p>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="title">Setting up the clinic phone</div>
          <ol className="meta" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            <li>{lan?.tunnelUrl ? <>The <b>anywhere link</b> is on, so the phone can be on any Wi-Fi or mobile data. Keep this computer on with the app running.</> : <>The clinic phone and this computer must be on the <b>same Wi-Fi</b> — or start the app with <b>start-with-anywhere-link-windows.bat</b> to use it from any network.</>}</li>
            <li>Press <b>Create phone link</b>, then send that link to the phone (WhatsApp it to yourself) and open it in Chrome.</li>
            <li>The first time, Chrome says <b>“Your connection isn't private”</b> — tap <b>Advanced → Proceed</b>. This is normal (the app makes its own security certificate). Then allow the <b>camera</b>.</li>
            <li>Keep the phone propped up with the screen on. If Windows asks about network access the first time, choose <b>Allow</b>.</li>
          </ol>
          {lan && !lan.httpsPort && <div className="login-error" style={{ marginBottom: 10 }}>The secure address is not running, so the phone camera may be blocked. Restart the app once after updating.</div>}
          {lan && lan.addresses.length === 0 && <div className="login-error" style={{ marginBottom: 10 }}>This computer is not connected to a network, so a phone cannot reach it.</div>}
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
                <span className={`badge ${enrolled[p.id]?.same_as ? "overdue" : enrolled[p.id] ? "done" : "sent"}`}>{enrolled[p.id]?.same_as ? `Same face as ${enrolled[p.id].same_as}` : enrolled[p.id] ? "Registered" : "Not registered"}</span>
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
            <span className={`badge ${l.kind === "out" ? "accepted" : l.mark === "P" ? "done" : "overdue"}`}>{l.kind === "out" ? "Logged out" : l.mark === "P" ? "Logged in" : "Logged in (late)"}</span>
          </div>
        ))}
      </div>
      {enrolling && <FaceEnrollModal person={enrolling} onClose={() => setEnrolling(null)} onDone={(m) => { setEnrolling(null); flash(m); load(); }} />}
    </>
  );
}
