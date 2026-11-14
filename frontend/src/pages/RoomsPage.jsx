import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
// "45 min" or "1 hr 5 min"; an open session counts up to the current time.
const dur = (inT, outT, nowT) => { const a = mins(inT), b = mins(outT || nowT); if (a == null || b == null || b < a) return ""; const d = b - a; return d >= 60 ? `${Math.floor(d / 60)} hr${d % 60 ? ` ${d % 60} min` : ""}` : `${d} min`; };
const t12 = (t) => { const m = mins(t); if (m == null) return t || ""; const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const nowIst = () => { const d = new Date(Date.now() + 19800000); return { hhmm: d.toISOString().slice(11, 16), date: d.toISOString().slice(0, 10) }; };
const prettyDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const detail = (s, nowT) => [`   🧑 Patient: ${s.patient}`, `   💆 Procedure: ${s.procedure}`, s.therapist && `   👩‍⚕️ Therapist: ${s.therapist}`, s.doctor && `   🩺 Doctor: ${s.doctor}`,
  `   🕐 Check-in: ${t12(s.checkIn)}`, s.checkOut ? `   🕑 Check-out: ${t12(s.checkOut)}` : null, dur(s.checkIn, s.checkOut, nowT) && `   ⏱️ Duration: ${dur(s.checkIn, s.checkOut, nowT)}${s.checkOut ? "" : " (running)"}`].filter(Boolean);
const msgFor = (s, out) => { const n = nowIst().hhmm; return [out ? "✅ *PROCEDURE COMPLETED*" : "🟢 *PROCEDURE STARTED*", `🏥 ${s.roomLabel}`, ...detail(s, n).map((l) => l.trim())].join("\n"); };
// One professional message for every room: who is in each room now (with timings), which rooms are empty, and what finished today.
const boardText = (data) => {
  const n = nowIst(), lines = ["🏥 *PROCEDURE ROOMS STATUS*", `📅 ${prettyDate(n.date)}  |  🕐 ${t12(n.hhmm)}`, ""];
  let floor = "";
  for (const r of data.rooms) {
    if (r.floor !== floor) { floor = r.floor; lines.push("━━━━━━━━━━━━━━", `*${floor.toUpperCase()}*`); }
    if (r.current) { lines.push(`🔴 *${r.name} - IN USE*`, ...detail(r.current, n.hhmm), ""); }
    else lines.push(`⚪ *${r.name} - EMPTY*`, "");
  }
  const done = data.sessions.filter((s) => s.checkOut);
  const busy = data.rooms.filter((r) => r.current).length;
  lines.push("━━━━━━━━━━━━━━", `📊 In use: ${busy}  |  Empty: ${data.rooms.length - busy}  |  Completed today: ${done.length}`);
  if (done.length) { lines.push("", "✅ *COMPLETED TODAY*"); done.forEach((s, i) => lines.push(`${i + 1}. ${s.roomLabel}: ${s.patient} - ${s.procedure}`, `   🕐 ${t12(s.checkIn)} → ${t12(s.checkOut)}  (⏱️ ${dur(s.checkIn, s.checkOut) || "-"})`)); }
  return lines.join("\n");
};
const copyText = async (text, done) => { try { await navigator.clipboard.writeText(text); done("Copied. Paste it in WhatsApp."); } catch { done("Could not copy. Use the Share button."); } };
const EMPTY = { patient: "", procedure: "", therapist: "", doctor: "", checkIn: "" };

export default function RoomsPage({ user, isStaffLayout, onLogout, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);          // room being filled
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);          // last saved entry -> WhatsApp share
  const [mobileOpen, setMobileOpen] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const load = () => api.listRooms(date).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, [date]);

  const start = async () => {
    setBusy(true); setError("");
    try { const s = await api.startRoom(open.key, form); setSent({ s, out: false }); setOpen(null); setForm(EMPTY); load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const finish = async (id) => {
    setError("");
    try { const s = await api.finishRoom(id, {}); setSent({ s, out: true }); load(); } catch (e) { setError(e.message); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const can = data?.canRecord;
  const floors = data ? [...new Set(data.rooms.map((r) => r.floor))] : [];

  const body = (
    <>
      <h2 style={{ margin: "8px 0 4px" }}>Procedure Rooms</h2>
      <p className="muted" style={{ marginTop: 0 }}>{can ? "Tap a room to add a patient. Tap Check Out when the procedure is finished." : "Live room status. Only the 3rd floor coordinator can add entries."}</p>
      {error && <div className="card" style={{ color: "#b91c1c" }}>{error}</div>}
      {data && <div style={{ margin: "6px 0 10px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><a className="btn btn-outline btn-sm" href={waLink(boardText(data))} target="_blank" rel="noreferrer">Share All Rooms Status To WhatsApp</a><button className="btn btn-light btn-sm" onClick={() => copyText(boardText(data), setNote)}>Copy Message</button>{note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}</div>}
      {sent && (
        <div className="card" style={{ borderLeft: "4px solid #16a34a" }}>
          <b>Saved.</b> Send it to the WhatsApp group:
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: "8px 0" }}>{msgFor(sent.s, sent.out)}</pre>
          <a className="btn btn-primary btn-sm" href={waLink(msgFor(sent.s, sent.out))} target="_blank" rel="noreferrer">Share This Room</a>{" "}
          {data && <a className="btn btn-outline btn-sm" href={waLink(boardText(data))} target="_blank" rel="noreferrer">Share All Rooms</a>}{" "}
          <button className="btn btn-light btn-sm" onClick={() => copyText(boardText(data), setNote)}>Copy All Rooms</button>{" "}
          <button className="btn btn-light btn-sm" onClick={() => setSent(null)}>Close</button>
        </div>
      )}
      {!data ? <p className="muted">Loading…</p> : floors.map((f) => (
        <div key={f} style={{ marginTop: 14 }}>
          <h3 style={{ margin: "0 0 8px" }}>{f}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 12 }}>
            {data.rooms.filter((r) => r.floor === f).map((r) => (
              <div key={r.key} className="card" style={{ margin: 0, borderTop: `4px solid ${r.current ? "#dc2626" : "#16a34a"}` }}>
                <b>{r.name}</b> <span className="muted" style={{ fontSize: 12 }}>· {r.current ? "In use" : "Empty"}</span>
                {r.current ? (
                  <div style={{ fontSize: 13, marginTop: 6 }}>
                    <div><b>{r.current.patient}</b></div><div>{r.current.procedure}</div>
                    <div className="muted">In: {t12(r.current.checkIn)}{r.current.therapist ? ` · ${r.current.therapist}` : ""}</div><div className="muted">⏱ {dur(r.current.checkIn, "", data.nowTime)} so far</div>
                    {can && <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => finish(r.current.id)}>Check Out</button>}
                  </div>
                ) : can ? (
                  <div><button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => { setOpen(r); setForm({ ...EMPTY, checkIn: data.nowTime }); setError(""); }}>Add Patient</button></div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      {open && (
        <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--primary)" }}>
          <h3 style={{ marginTop: 0 }}>{open.floor} — {open.name}</h3>
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            <input placeholder="Patient Name" value={form.patient} onChange={set("patient")} />
            <input placeholder="Procedure Name" value={form.procedure} onChange={set("procedure")} />
            <input placeholder="Therapist Name" list="room-staff" value={form.therapist} onChange={set("therapist")} />
            <input placeholder="Doctor Name" list="room-staff" value={form.doctor} onChange={set("doctor")} />
            <datalist id="room-staff">{data.staffNames.map((n) => <option key={n} value={n} />)}</datalist>
            <label className="muted" style={{ fontSize: 12 }}>Check-in Time<input type="time" value={form.checkIn} onChange={set("checkIn")} style={{ display: "block" }} /></label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy || !form.patient.trim() || !form.procedure.trim()} onClick={start}>{busy ? "Saving…" : "Save & Check In"}</button>{" "}
            <button className="btn btn-light" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      )}
      {data && (
        <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>{date && date !== data.nowDate ? `Log For ${date}` : "Today's Log"}</h3>
            <label className="muted" style={{ fontSize: 12 }}>Day <input type="date" value={date || data.date} max={data.nowDate} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          {data.sessions.length === 0 ? <p className="muted">No entries yet.</p> : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ textAlign: "left" }}><th>Room</th><th>Patient</th><th>Procedure</th><th>Therapist</th><th>Doctor</th><th>In</th><th>Out</th><th>Duration</th><th></th></tr></thead>
              <tbody>{[...data.sessions].sort((a, b) => a.room.localeCompare(b.room) || a.checkIn.localeCompare(b.checkIn)).map((s) => (
                <tr key={s.id}><td>{s.roomLabel}</td><td>{s.patient}</td><td>{s.procedure}</td><td>{s.therapist}</td><td>{s.doctor}</td><td>{t12(s.checkIn)}</td><td>{s.checkOut ? t12(s.checkOut) : "—"}</td><td>{dur(s.checkIn, s.checkOut, data.nowTime) || "—"}{s.checkOut ? "" : " (running)"}</td>
                  <td><a href={waLink(msgFor(s, !!s.checkOut))} target="_blank" rel="noreferrer">Share</a></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{body}</div>;
  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Procedure Rooms" onSelect={(i) => i !== "Procedure Rooms" && onBack(i)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main"><MobileTopBar title="Procedure Rooms" onOpenMenu={() => setMobileOpen(true)} />{body}</div>
    </div>
  );
}
