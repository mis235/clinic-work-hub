import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import FinesPanel from "../components/FinesPanel.jsx";
import FaceEnrollModal from "../components/FaceEnrollModal.jsx";
import { snapUrl } from "../api.js";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const MARKS = [["P", "Present", "done"], ["L", "Late", "overdue"], ["H", "Half day", "accepted"], ["LV", "Leave", "accepted"], ["A", "Absent", "overdue"], ["W", "Off", "accepted"]];
const CYCLE = ["", "P", "L", "A", "H", "LV", "W"];
const CUTOFF = "2026-11-18"; // from Wednesday: Present / Late / Half day only from check-in times
const CYCLE_AFTER = ["", "A", "LV", "W"];
const t12 = (t) => { const [h, m] = String(t).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const short = (t) => String(t).replace(/^0/, "");
const shiftDay = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

// Attendance is marked by the admin / manager (like the paper register). Staff do not check in on the app.
export default function AttendancePage({ user, onLogout, onBack }) {
  const [date, setDate] = useState(todayIST());
  const [board, setBoard] = useState(null);
  const [reg, setReg] = useState(null);
  const [tab, setTab] = useState("register");
  const [fix, setFix] = useState(null);
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
        <div><div className="eyebrow">People</div><h1>Attendance</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn btn-outline btn-sm" disabled={dlBusy} onClick={download}>{dlBusy ? "Preparing…" : "⬇ Attendance sheet (Excel)"}</button><input className="field" type="date" style={{ width: 180 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <div className="dept-grid tile-grid">
        {[["Present", c.P, "green"], ["Late", c.L], ["Half day", c.H], ["On leave", c.LV], ["Absent", c.A], ["Not marked", c.unmarked]].map(([l, n]) => (
          <div key={l} className="dept-card"><div className="meta">{l}</div><div className="title" style={{ fontSize: 24 }}>{n ?? 0}</div></div>
        ))}
      </div>

      <div className="pill-row">
        <button className={`pill ${tab === "register" ? "active" : ""}`} onClick={() => setTab("register")}>Month register</button>
        <button className={`pill ${tab === "late" ? "active" : ""}`} onClick={() => setTab("late")}>Late reasons</button>
        <button className={`pill ${tab === "face" ? "active" : ""}`} onClick={() => setTab("face")}>Face check-in</button>
        {user.role === "admin" && SETUP && <button className={`pill ${tab === "sheet" ? "active" : ""}`} onClick={() => setTab("sheet")}>Google Sheet</button>}
        {user.role === "admin" && <button className={`pill ${tab === "fines" ? "active" : ""}`} onClick={() => setTab("fines")}>Fines</button>}
        <button className={`pill ${tab === "notes" ? "active" : ""}`} onClick={() => setTab("notes")}>Staff Messages</button>
      </div>

      {fix && (
        <div className="modal-backdrop" onClick={() => setFix(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{fix.name} · {new Date(fix.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
                        <label className="field-label">Check-in time</label><input className="field" type="time" value={fix.inTime} onChange={(e) => setFix({ ...fix, inTime: e.target.value })} />
            <label className="field-label">Check-out time</label><input className="field" type="time" value={fix.outTime} onChange={(e) => setFix({ ...fix, outTime: e.target.value })} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={!fix.inTime && !fix.outTime} onClick={async () => { try { await api.fixAttendanceTime({ userId: fix.userId, date: fix.date, inTime: fix.inTime, outTime: fix.outTime }); setFix(null); load(); flash("Saved."); } catch (e) { flash(e.message); } }}>Save Times</button>
            <div className="meta" style={{ marginTop: 12 }}>Mark the day as</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {[["A", "Absent"], ["LV", "Leave"], ["W", "Off"], ["", "Clear"]].map(([k, l]) => <button key={l} className="btn btn-outline btn-sm" onClick={async () => { await mark(fix.userId, fix.date, k); setFix(null); }}>{l}</button>)}
            </div>
            <div className="actions"><button className="btn btn-ghost" onClick={() => setFix(null)}>Close</button></div>
          </div>
        </div>)}

      {tab === "register" && (!reg ? <div className="empty">Loading…</div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div className="meta">{reg.month}</div>
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
            <thead><tr><th>Staff</th>{Array.from({ length: reg.daysInMonth }, (_, i) => <th key={i}>{i + 1}</th>)}<th>Pres</th><th>Late</th><th>Late min</th><th>Abs</th><th>Leave</th><th>Fines</th></tr></thead>
            <tbody>{reg.rows.map((r) => (
              <tr key={r.id}><td className="nm">{r.name}{r.shift && <div className="meta">{r.shift}</div>}</td>
                {r.days.map((d, i) => {
                  const day = `${reg.month}-${String(i + 1).padStart(2, "0")}`;
                  const future = day > todayIST();
                  const t = r.times?.[i];
                  const onClick = () => {
                    if (future) return;
                    if (day >= CUTOFF) setFix({ userId: r.id, name: r.name, date: day, inTime: t?.i || "", outTime: t?.o || "" });
                    else mark(r.id, day, CYCLE[(CYCLE.indexOf(d) + 1) % CYCLE.length]);
                  };
                  return (
                    <td key={i} className={`c-${d || "x"} ${future ? "" : "clk"}`} onClick={onClick} title={t ? `In ${t.i || "-"} · Out ${t.o || "-"}${t.l ? ` · Late ${t.l} min` : ""}${t.r ? ` · Reason: ${t.r}` : ""}` : ""}>
                      <div>{d === "LV" ? "Lv" : d}{t?.l ? <span className="reg-late"> +{t.l}m</span> : null}</div>
                      {t && <div className="reg-time">{t.i ? short(t.i) : "–"}</div>}
                      {t && <div className="reg-time out">{t.o ? short(t.o) : "–"}</div>}
                    </td>);
                })}
                <td><b>{r.present}</b></td><td>{r.late || ""}</td><td>{r.lateMinutes || ""}</td><td>{r.absent || ""}</td><td>{r.leave || ""}</td><td>{r.fine_total ? "₹" + r.fine_total : ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {tab === "late" && <LateReasonsPanel month={month} />}
      {tab === "face" && <FacePanel date={date} people={board?.rows || []} isAdmin={user.role === "admin"} flash={flash} />}
      {tab === "sheet" && SETUP && <SheetPanel flash={flash} onChanged={load} />}
      {tab === "notes" && <MessagesPanel flash={flash} />}
      {tab === "fines" && <FinesPanel month={month} isAdmin={user.role === "admin"} preset={preset} onChanged={load} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function LateReasonsPanel({ month }) {
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); const load = () => api.lateReasons(month).then(setD).catch(() => setD({ rows: [] })); load(); window.addEventListener("hub-refresh", load); return () => window.removeEventListener("hub-refresh", load); }, [month]);
  if (!d) return <div className="empty">Loading…</div>;
  const without = d.rows.filter((r) => !r.reason).length;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="meta" style={{ marginBottom: 8 }}>{d.month} · {d.rows.length} late arrival{d.rows.length === 1 ? "" : "s"}{without ? ` · ${without} without a reason` : ""}</div>
      {d.rows.length === 0 ? <div className="meta">Nobody was late this month.</div> : (
        <table className="tbl" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Date</th><th style={{ textAlign: "left" }}>Name</th><th>In</th><th>Late</th><th style={{ textAlign: "left" }}>Reason</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.user_id + r.date}>
              <td>{new Date(r.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</td>
              <td><b>{r.name}</b></td><td style={{ textAlign: "center" }}>{r.in_time}</td><td style={{ textAlign: "center" }}>{r.late ? r.late + " min" : "–"}</td>
              <td>{r.reason || <span className="meta">No reason yet</span>}</td>
            </tr>))}</tbody>
        </table>)}
    </div>
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
        <div className="title">How It Works</div>
        <p className="meta" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>Register each person's face once. Leave the clinic phone open on the check-in screen. The <b>first</b> time someone looks at the camera each day is their <b>login</b> (marked Present, or Late after 10:30 AM). Looking again later (at least 30 minutes after) records their <b>logout</b>. One face can belong to only one person. A picture of each check-in is saved below for you to review.</p>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="title">Setting Up the Clinic Phone</div>
          <ol className="meta" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
            <li>Use the clinic phone (any Android phone or iPhone with Chrome or Safari). It works on Wi-Fi or mobile data.</li>
            <li>Press <b>Create phone link</b> below, send that link to the phone (WhatsApp it to yourself) and open it there.</li>
            <li>Allow the <b>camera</b> when the phone asks. Then add it to the home screen (menu → Add to Home screen) so it opens in one tap.</li>
            <li>Keep the phone propped up at the front desk with the screen on and plugged in to charge.</li>
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
          <div className="title" style={{ marginBottom: 6 }}>Face Enrollment</div>
          {people.map((p) => (
            <div key={p.id} className="task-row">
              <div><div className="title">{p.name}</div><div className="meta">{p.designation || p.department}</div></div>
              <div className="right" style={{ gap: 8 }}>
                <span className={`badge ${enrolled[p.id]?.same_as ? "overdue" : enrolled[p.id] ? "done" : "sent"}`}>{enrolled[p.id]?.same_as ? `Same face as ${enrolled[p.id].same_as}` : enrolled[p.id] ? "Enrolled" : "Not enrolled"}</span>
                <button className="btn btn-outline btn-sm" onClick={() => setEnrolling(p)}>{enrolled[p.id] ? "Re-enroll" : "Enroll face"}</button>
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

const KIND = { announcement: "Announcement", early_leave: "Left early", stayed_late: "Stayed late", no_morning_checkin: "No morning check-in" };
function MessagesPanel({ flash }) {
  const [d, setD] = useState(null);
  const load = () => api.listMessages().then(setD).catch((e) => { setD({ messages: [], enabled: true }); flash(e.message); });
  useEffect(() => { load(); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div><div className="title">Kind Notes Sent to Staff</div>
          <div className="meta">When someone leaves early, stays late or checks out with no morning check-in, they get a warm note in the app and by email.</div></div>
        <label className="pill" style={{ cursor: "pointer" }}><input type="checkbox" checked={d.enabled} onChange={async (e) => { await api.setMessagesOn(e.target.checked); load(); }} /> Send Automatically</label>
      </div>
      <Announce flash={flash} onSent={load} />
      {d.messages.length === 0 && <div className="empty">No notes sent yet.</div>}
      {d.messages.map((m) => (
        <div key={m.id} className="task-row">
          <div><div className="title">{m.name} <span className="meta">· {m.kind.startsWith("announce") ? "Announcement" : m.kind.startsWith("auto") ? "Auto message" : KIND[m.kind] || m.kind} · {m.date}</span></div>
            <div className="meta">{m.body}</div>
            <div className="meta">In the app: {m.readAt ? "Read" : "Waiting"} · Email: {m.emailStatus || "—"}</div></div>
          {m.whatsappUrl && <a className="btn btn-outline btn-sm" href={m.whatsappUrl} target="_blank" rel="noreferrer">Send on WhatsApp</a>}
        </div>))}
    </div>
  );
}

function Announce({ flash, onSent }) {
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  async function send() {
    setBusy(true);
    try { const r = await api.sendAnnouncement(title, body); setRes(r); setTitle(""); setBody(""); onSent(); flash(`Sent to ${r.sent} staff in the app${r.emailed ? `, ${r.emailed} by email` : ""}${r.viaWhatsapp ? `, ${r.viaWhatsapp} by WhatsApp (TeleCRM)` : ""}.`); }
    catch (e) { flash(e.message); }
    setBusy(false);
  }
  async function contacts() {
    const rows = await api.staffContacts();
    const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
    const csv = ["Name,Designation,Clinic Number,Personal Number,Email", ...rows.map((r) => [r.name, r.designation, r.phone, r.altPhone, r.email].map(q).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "staff-contacts.csv"; a.click();
  }
  return (
    <div style={{ background: "var(--bg-soft, #faf5fb)", borderRadius: 12, padding: 14, margin: "14px 0" }}>
      <div className="title">New Announcement</div>
      <div className="meta" style={{ marginBottom: 8 }}>Goes to every staff member as a banner in the app and by email. You can then send it on WhatsApp below.</div>
      <input className="field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="field" rows={4} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 8 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={busy || !title.trim() || !body.trim()} onClick={send}>{busy ? "Sending…" : "Send to All Staff"}</button>
        <button className="btn btn-outline" onClick={contacts}>Download Contacts for TeleCRM</button>
      </div>
      {res && <div style={{ marginTop: 12 }}>
        <div className="meta" style={{ marginBottom: 6 }}>Send on WhatsApp (tap a number to open WhatsApp with the message ready):</div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(res.text)}>Copy Message</button>
        {res.recipients.map((r) => (
          <div key={r.name} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", flexWrap: "wrap" }}>
            <span style={{ minWidth: 130 }}>{r.name}</span>
            {r.whatsappUrl ? <a className="btn btn-outline btn-sm" href={r.whatsappUrl} target="_blank" rel="noreferrer">Clinic Number</a> : <span className="meta">No number</span>}
            {r.whatsappUrl2 && <a className="btn btn-outline btn-sm" href={r.whatsappUrl2} target="_blank" rel="noreferrer">Personal Number</a>}
          </div>))}
      </div>}
    </div>
  );
}


const SETUP = typeof location !== "undefined" && new URLSearchParams(location.search).has("setup");

// Admin: a live Google Sheet copy of attendance, and clearing the old data.
function SheetPanel({ flash, onChanged }) {
  const [d, setD] = useState(null), [url, setUrl] = useState(""), [link, setLink] = useState(""), [busy, setBusy] = useState(false);
  const [before, setBefore] = useState(CUTOFF), [pre, setPre] = useState(null), [word, setWord] = useState(""), [done, setDone] = useState("");
  const load = () => api.attSheet().then((x) => { setD(x); setUrl(x.url || ""); setLink(x.link || ""); }).catch((e) => flash(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { setPre(null); setWord(""); api.clearOldPreview(before).then(setPre).catch(() => {}); }, [before]);
  if (!d) return <div className="empty">Loading…</div>;
  const copy = (t) => { navigator.clipboard?.writeText(t); flash("Copied."); };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Attendance in Google Sheets</h3>
        <div className="meta">Every check-in, check-out and fix goes to your Google Sheet within a minute. One tab per month (day by day) and one summary tab. Download it from Google Sheets: File → Download → Excel.</div>
        <div className="meta" style={{ marginTop: 8 }}><b>Set up once (5 minutes):</b></div>
        <ol className="meta" style={{ margin: "4px 0 8px 18px", lineHeight: 1.7 }}>
          <li>Open Google Sheets, make a new empty sheet, name it “Clinic Attendance”. Copy its link from the address bar into the box below.</li>
          <li>In that sheet click <b>Extensions → Apps Script</b>. Delete everything there.</li>
          <li><button className="btn btn-outline btn-sm" onClick={() => copy(d.script)}>Copy the script</button> and paste it into Apps Script. Click the save icon.</li>
          <li>Click <b>Deploy → New deployment</b>. Click the gear and choose <b>Web app</b>. Set “Execute as” = Me and “Who has access” = <b>Anyone</b>. Click Deploy, allow access, then copy the <b>Web app URL</b> (ends with /exec).</li>
          <li>Paste both links below and press Save. Then press “Send everything now”.</li>
        </ol>
        <label className="field-label">Google Sheet link</label><input className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
        <label className="field-label">Web app URL (ends with /exec)</label><input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={async () => { try { await api.saveAttSheet({ url, link }); flash("Saved."); load(); } catch (e) { flash(e.message); } }}>Save</button>
          <button className="btn btn-outline btn-sm" disabled={busy || !d.url} onClick={async () => { setBusy(true); try { await api.sendAttSheet(); flash("Sent to Google Sheet."); load(); } catch (e) { flash(e.message); } setBusy(false); }}>{busy ? "Sending…" : "Send everything now"}</button>
          {d.link && <a className="btn btn-outline btn-sm" href={d.link} target="_blank" rel="noreferrer">Open Google Sheet</a>}
        </div>
        {d.status && <div className="meta" style={{ marginTop: 8 }}>Last: {d.status}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Remove old attendance</h3>
        <div className="meta">This deletes the attendance entries before the date you choose (the hand-marked P / L / A of the old way). Late fines that came from them are recalculated. Manual fines stay. A safety copy is kept on the server first.</div>
        <div className="meta" style={{ marginTop: 6 }}><b>Do first:</b> press “Send everything now” above (or download the Excel) so you also have the data in Google Sheets.</div>
        <label className="field-label">Delete everything before</label><input className="field" type="date" style={{ width: 200 }} value={before} max={todayIST()} onChange={(e) => setBefore(e.target.value)} />
        <div className="meta" style={{ marginTop: 6 }}>{pre ? (pre.count ? `${pre.count} entries will be deleted (${pre.from} to ${pre.to}).` : "Nothing to delete before this date.") : ""}</div>
        <label className="field-label">Type DELETE to confirm</label><input className="field" style={{ width: 200 }} value={word} onChange={(e) => setWord(e.target.value)} />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={word !== "DELETE" || !pre?.count} onClick={async () => { try { const r = await api.clearOldAttendance(before, word); setDone(`${r.deleted} entries deleted. Safety copy: ${r.backup || "-"}`); setWord(""); onChanged(); } catch (e) { flash(e.message); } }}>Delete old attendance</button>
        {done && <div className="meta" style={{ marginTop: 8 }}>{done}</div>}
      </div>
    </div>);
}
