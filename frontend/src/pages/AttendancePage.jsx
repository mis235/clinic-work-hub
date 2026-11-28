import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import FinesPanel from "../components/FinesPanel.jsx";
import FaceEnrollModal from "../components/FaceEnrollModal.jsx";
import { snapUrl } from "../api.js";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const MARKS = [["P", "Present", "done"], ["L", "Late", "overdue"], ["H", "Half day", "accepted"], ["LV", "Leave", "accepted"], ["A", "Absent", "overdue"], ["W", "Off", "accepted"]];
const CYCLE = ["", "P", "L", "A", "H", "LV", "W"];
const CUTOFF = "2026-11-18"; // from Wednesday: Present / Late / Half day only from In Time times
const CYCLE_AFTER = ["", "A", "LV", "W"];
const t12 = (t) => { const [h, m] = String(t).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const short = (t) => String(t).replace(/^0/, "");
const shiftDay = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

// Attendance is marked by the admin / manager (like the paper register). Staff do not punch in on the app.
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
  const [ver, setVer] = useState(0); // goes up after every change, so the Late & checks list refreshes after an HR edit

  const load = () => {
    setVer((v) => v + 1);
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
        <button className={`pill ${tab === "late" ? "active" : ""}`} onClick={() => setTab("late")}>Late &amp; checks</button>
        <button className={`pill ${tab === "face" ? "active" : ""}`} onClick={() => setTab("face")}>Face attendance</button>
        {user.role === "admin" && SETUP && <button className={`pill ${tab === "sheet" ? "active" : ""}`} onClick={() => setTab("sheet")}>Google Sheet</button>}
        {user.role === "admin" && <button className={`pill ${tab === "fines" ? "active" : ""}`} onClick={() => setTab("fines")}>Fines</button>}
        <button className={`pill ${tab === "notes" ? "active" : ""}`} onClick={() => setTab("notes")}>Staff Messages</button>
      </div>

      {fix && (
        <div className="modal-backdrop" onClick={() => setFix(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{fix.name} · {new Date(fix.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
                        <label className="field-label">In Time</label><input className="field" type="time" value={fix.inTime} onChange={(e) => setFix({ ...fix, inTime: e.target.value })} />
            <label className="field-label">Out Time</label><input className="field" type="time" value={fix.outTime} onChange={(e) => setFix({ ...fix, outTime: e.target.value })} />
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

      {tab === "late" && <LateReasonsPanel month={month} ver={ver} />}
      {tab === "face" && <FacePanel date={date} people={board?.rows || []} isAdmin={user.role === "admin"} flash={flash} />}
      {tab === "sheet" && SETUP && <SheetPanel flash={flash} onChanged={load} />}
      {tab === "notes" && <MessagesPanel flash={flash} />}
      {tab === "fines" && <FinesPanel month={month} isAdmin={user.role === "admin"} preset={preset} onChanged={load} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function LateReasonsPanel({ month, ver }) {
  const today = todayIST();
  const monthRange = (m) => { const [y, mo] = m.split("-").map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate(), end = `${m}-${String(last).padStart(2, "0")}`; return { from: `${m}-01`, to: m === today.slice(0, 7) ? today : end }; };
  const [range, setRange] = useState(monthRange(month)), [custom, setCustom] = useState(false);
  const [d, setD] = useState(null), [f, setF] = useState("all"), [tick, setTick] = useState(0);
  useEffect(() => { if (!custom) setRange(monthRange(month)); }, [month]); // follows the Month register until a range is chosen by hand
  const load = () => api.lateReasons(range.from, range.to).then(setD).catch(() => setD({ rows: [] }));
  useEffect(() => { load(); }, [range.from, range.to, ver, tick]);   // also after every change made on this page
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000), h = () => setTick((x) => x + 1); window.addEventListener("hub-refresh", h); window.addEventListener("focus", h); return () => { clearInterval(t); window.removeEventListener("hub-refresh", h); window.removeEventListener("focus", h); }; }, []);
  const addDays = (n) => new Date(new Date(today + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
  const pick = (from, to, c = true) => { setCustom(c); setRange({ from, to }); };
  const prevMonth = (() => { const d0 = new Date(today.slice(0, 7) + "-01T00:00:00Z"); d0.setUTCMonth(d0.getUTCMonth() - 1); return d0.toISOString().slice(0, 7); })();
  const QUICK = [["Today", () => pick(today, today)], ["Yesterday", () => pick(addDays(-1), addDays(-1))], ["Last 7 days", () => pick(addDays(-6), today)], ["This month", () => pick(today.slice(0, 7) + "-01", today)], ["Last month", () => { const r = monthRange(prevMonth); pick(r.from, r.to); }]];
  const head = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <label className="meta">From</label><input className="field" type="date" style={{ maxWidth: 160 }} value={range.from} max={range.to} onChange={(e) => e.target.value && pick(e.target.value, range.to)} />
      <label className="meta">To</label><input className="field" type="date" style={{ maxWidth: 160 }} value={range.to} min={range.from} onChange={(e) => e.target.value && pick(range.from, e.target.value)} />
      {QUICK.map(([l, fn]) => <button key={l} className="pill" onClick={fn}>{l}</button>)}
      {custom && <button className="pill" onClick={() => { setCustom(false); setRange(monthRange(month)); }}>Follow the register month</button>}
    </div>
  );
  if (!d) return <div className="card">{head}<div className="empty">Loading…</div></div>;
  const TYPES = { late: ["Late", "#d97706"], noin: ["In Time missing", "#dc2626"], noout: ["Out Time missing", "#dc2626"], early: ["Left early", "#0ea5e9"], half: ["Half day", "#7c3aed"] };
  const rows = d.rows.filter((r) => f === "all" || r.type === f);
  const without = d.rows.filter((r) => !r.reason).length;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      {head}
      <div className="meta" style={{ marginBottom: 8 }}>{new Date(range.from + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })} to {new Date(range.to + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · {d.rows.length} to look at{without ? ` · ${without} without a reason` : ""} · updates by itself</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button className={`pill ${f === "all" ? "active" : ""}`} onClick={() => setF("all")}>All</button>
        {Object.entries(TYPES).map(([k, [l]]) => <button key={k} className={`pill ${f === k ? "active" : ""}`} onClick={() => setF(k)}>{l} ({d.rows.filter((r) => r.type === k).length})</button>)}
      </div>
      {rows.length === 0 ? <div className="meta">Nothing here for these dates.</div> : (
        <table className="tbl" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Date</th><th style={{ textAlign: "left" }}>Name</th><th>In</th><th>Out</th><th style={{ textAlign: "left" }}>What</th><th style={{ textAlign: "left" }}>Reason</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.user_id + r.date + r.type + i}>
              <td>{new Date(r.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</td>
              <td><b>{r.name}</b></td><td style={{ textAlign: "center" }}>{r.in_time || "–"}</td><td style={{ textAlign: "center" }}>{r.out_time || "–"}</td>
              <td><b style={{ color: TYPES[r.type][1] }}>{r.detail}</b></td>
              <td>{r.reason || <span className="meta">No reason yet</span>}</td>
            </tr>))}</tbody>
        </table>)}
    </div>
  );
}

function FacePanel({ date, people, isAdmin, flash }) {
  const [enrolled, setEnrolled] = useState({});
  const [log, setLog] = useState([]);
  const [devices, setDevices] = useState([]); const [phones, setPhones] = useState([]); const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  const [lan, setLan] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const load = () => {
    if (isAdmin) { api.enrolledFaces().then((r) => setEnrolled(Object.fromEntries(r.map((x) => [x.user_id, x])))).catch(() => {}); api.kioskDevices().then(setDevices).catch(() => {}); api.kioskLan().then(setLan).catch(() => {}); api.kioskSharedLink().then((d) => setLink(`${window.location.origin}/kiosk?key=${encodeURIComponent(d.key)}`)).catch(() => {}); api.kioskPhones().then(setPhones).catch(() => {}); }
    api.kioskLog(date).then(setLog).catch(() => setLog([]));
  };
  useEffect(load, [date]);
  const secure = window.isSecureContext;
  const [geo, setGeo] = useState(null), [geoBusy, setGeoBusy] = useState(false);
  useEffect(() => { if (isAdmin) api.kioskGeo().then(setGeo).catch(() => {}); }, [isAdmin]);
  const saveGeo = async (body) => { try { setGeo(await api.saveKioskGeo(body)); flash("Saved"); } catch (e) { flash(e.message); } };
  const [placeName, setPlaceName] = useState("");
  const setHere = () => {
    if (!navigator.geolocation) { flash("This device cannot share its location"); return; }
    if (!placeName.trim()) { flash("Type the place name first, for example Road No. 7"); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(async (p) => { setGeoBusy(false); await saveGeo({ name: placeName.trim(), lat: p.coords.latitude, lng: p.coords.longitude, on: true }); setPlaceName(""); },
      () => { setGeoBusy(false); flash("Allow Location for this website, then try again"); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };
  return (
    <>

      {isAdmin && (
        <div className="card">
          <div className="title">Clinic Attendance Link</div>
          {link && <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <input className="field" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary btn-sm" onClick={() => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {} }}>{copied ? "Copied" : "Copy"}</button>
          </div>}
          {phones.map((p) => (
            <div key={p.id} className="task-row"><div><div className="title">{p.label}{p.blocked_at ? " · off" : ""}</div><div className="meta">Last used {p.last_seen ? new Date(p.last_seen.replace(" ", "T") + "Z").toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"} · {p.today} today{p.scan_mode ? ` · ${p.scan_mode === "cpu" ? "Slow scanner" : "Fast scanner"}, ready in ${Math.max(1, Math.round((p.ready_ms || 0) / 1000))} s` : ""}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={async () => { await api.saveKioskPhone(p.id, { blocked: !p.blocked_at }); load(); }}>{p.blocked_at ? "Switch on" : "Switch off"}</button></div>
          ))}
        </div>
      )}

      {isAdmin && geo && (
        <div className="card">
          <div className="title">Attendance Locations</div>
          <div className="task-row"><div><div className="title">{geo.on ? "Location limit is ON" : "Location limit is OFF"}</div><div className="meta">{geo.points.length ? `${geo.points.length} place${geo.points.length === 1 ? "" : "s"} saved · within ${geo.radius} m of each` : "No place saved yet"}</div></div>
            {geo.points.length > 0 && <button className="btn btn-outline btn-sm" onClick={() => saveGeo({ on: !geo.on })}>{geo.on ? "Turn off" : "Turn on"}</button>}</div>
          {geo.points.map((p, i) => <div key={i} className="task-row"><div className="title">{p.name}</div><button className="btn btn-ghost btn-sm" onClick={() => saveGeo({ remove: i })}>Remove</button></div>)}
          <div className="task-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="field" style={{ flex: 1, minWidth: 180 }} value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Place name, e.g. Road No. 3 (Jains Shantkunj)" />
            <button className="btn btn-primary btn-sm" disabled={geoBusy} onClick={setHere}>{geoBusy ? "Getting location…" : "Add this place"}</button>
          </div>
          {geo.points.length > 0 && <div className="task-row"><div className="meta">Allowed distance from each place</div>
            <select className="field" style={{ maxWidth: 140 }} value={geo.radius} onChange={(e) => saveGeo({ radius: Number(e.target.value) })}>{[50, 100, 150, 200, 300, 500].map((n) => <option key={n} value={n}>{n} metres</option>)}</select></div>}
        </div>
      )}

      {isAdmin && (
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>Face Enrollment</div>
          {people.map((p) => (
            <div key={p.id} className="task-row">
              <div><div className="title">{p.name}</div><div className="meta">{p.designation || p.department}</div></div>
              <div className="right" style={{ gap: 8 }}>
                <span className={`badge ${enrolled[p.id]?.same_as || enrolled[p.id]?.old ? "overdue" : enrolled[p.id] ? "done" : "sent"}`}>{enrolled[p.id]?.same_as ? `Same face as ${enrolled[p.id].same_as}` : enrolled[p.id]?.old ? "Register again" : enrolled[p.id] ? "Enrolled" : "Not enrolled"}</span>
                <button className="btn btn-outline btn-sm" onClick={() => setEnrolling(p)}>{enrolled[p.id] && !enrolled[p.id].old ? "Re-enroll" : "Enroll face"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>Face attendances on {date}</div>
        {log.length === 0 && <div className="empty">No face attendances yet.</div>}
        {log.map((l) => (
          <div key={l.id} className="task-row">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {l.has_snap && <img alt="" src={snapUrl(l.id)} style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />}
              <div><div className="title">{l.name}</div><div className="meta">{new Date(l.created_at.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · match {Math.round((1 - l.distance) * 100)}%</div></div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`badge ${l.kind === "out" ? "accepted" : l.mark === "P" ? "done" : "overdue"}`}>{l.kind === "out" ? "Punch Out" : l.mark === "P" ? "Punch In" : "Punch In (Late)"}</span>
              <button className="btn btn-ghost btn-sm" onClick={async () => { if (!window.confirm(`Cancel this entry for ${l.name}? Use it when the photo is a different person.`)) return; try { await api.undoKioskCheckin(l.id); flash("Cancelled — that day is back as it was"); load(); } catch (e) { flash(e.message); } }}>Wrong person</button>
            </div>
          </div>
        ))}
      </div>
      {enrolling && <FaceEnrollModal person={enrolling} onClose={() => setEnrolling(null)} onDone={(m) => { setEnrolling(null); flash(m); load(); }} />}
    </>
  );
}

const KIND = { announcement: "Announcement", early_leave: "Left early", stayed_late: "Stayed late", no_morning_checkin: "No morning In Time" };
function MessagesPanel({ flash }) {
  const [d, setD] = useState(null);
  const load = () => api.listMessages().then(setD).catch((e) => { setD({ messages: [], enabled: true }); flash(e.message); });
  useEffect(() => { load(); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div><div className="title">Kind Notes Sent to Staff</div></div>
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
      <input className="field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="field" rows={4} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 8 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={busy || !title.trim() || !body.trim()} onClick={send}>{busy ? "Sending…" : "Send to All Staff"}</button>
        <button className="btn btn-outline" onClick={contacts}>Download Contacts for TeleCRM</button>
      </div>
      {res && <div style={{ marginTop: 12 }}>
        <div className="meta" style={{ marginBottom: 6 }}>Send on WhatsApp:</div>
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
