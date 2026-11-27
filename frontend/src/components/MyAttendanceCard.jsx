import { useEffect, useState } from "react";
import { api } from "../api.js";

const istMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);
const shift = (m, n) => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
const COLOR = { P: "#16a34a", L: "#d97706", H: "#0ea5e9", LV: "#7c3aed", A: "#dc2626", W: "#9ca3af" };
const NAME = { P: "Present", L: "Late", H: "Half day", LV: "Leave", A: "Absent", W: "Week off" };

// A staff member's own attendance for the month: login and logout times, late count, fines.
const QUICK = ["Traffic", "Rain", "Health problem", "Family reason", "Bus / transport delay"];
const QUICK_NOIN = ["I forgot to scan", "Phone problem", "Face was not recognised", "I came on time, scan failed"];
// If I was late in the last 7 days, I can say why. The admin sees it at once.
function LateAsk() {
  const [days, setDays] = useState([]), [txt, setTxt] = useState({}), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const load = () => api.myLateDays().then(setDays).catch(() => {});
  useEffect(() => { load(); window.addEventListener("hub-refresh", load); return () => window.removeEventListener("hub-refresh", load); }, []);
  async function save(date) {
    setErr(""); setBusy(date);
    try { await api.saveLateReason(date, txt[date] || ""); await load(); } catch (e) { setErr(e.message); }
    setBusy("");
  }
  if (!days.length) return null;
  return (
    <div className="myatt-late" style={{ margin: "12px 0", padding: 12, borderRadius: 14, background: "#fff7ed", border: "1px solid #fed7aa" }}>
      <b style={{ color: "#9a3412" }}>Please tell us why</b>
      {days.map((l) => (
        <div key={l.date} style={{ marginTop: 8 }}>
          <div className="meta">{new Date(l.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · {l.kind === "noin" ? "no morning clock-in" : `in at ${l.in_time}${l.late ? ` · ${l.late} min late` : ""}`}</div>
          {l.reason ? <div style={{ marginTop: 4 }}>Your reason: <b>{l.reason}</b> <button className="btn btn-outline btn-sm" style={{ marginLeft: 6 }} onClick={() => setDays(days.map((x) => x.date === l.date ? { ...x, reason: "" } : x))}>Change</button></div> : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
                {(l.kind === "noin" ? QUICK_NOIN : QUICK).map((q) => <button key={q} type="button" className="pill" onClick={() => setTxt({ ...txt, [l.date]: q })}>{q}</button>)}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="field" style={{ flex: 1, fontSize: 16 }} value={txt[l.date] || ""} onChange={(e) => setTxt({ ...txt, [l.date]: e.target.value })} placeholder={l.kind === "noin" ? "Why is there no morning clock-in?" : "Why were you late?"} maxLength={200} />
                <button className="btn btn-primary btn-sm" disabled={busy === l.date} onClick={() => save(l.date)}>{busy === l.date ? "…" : "Send"}</button>
              </div>
            </>)}
        </div>))}
      {err && <div className="login-error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

export default function MyAttendanceCard() {
  const [month, setMonth] = useState(istMonth()), [d, setD] = useState(null);
  useEffect(() => { setD(null); const load = () => api.myAttendanceMonth(month).then(setD).catch(() => {}); load(); window.addEventListener("hub-refresh", load); return () => window.removeEventListener("hub-refresh", load); }, [month]);
  const me = d?.rows?.[0];
  const stat = (n, l, c) => <div className="myatt-stat"><b style={{ color: c }}>{n}</b><span>{l}</span></div>;
  return (
    <div className="card myatt">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>My Attendance</b>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn btn-outline btn-sm" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">‹</button>
          <span className="meta" style={{ minWidth: 92, textAlign: "center" }}>{new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
          <button className="btn btn-outline btn-sm" disabled={month >= istMonth()} onClick={() => setMonth(shift(month, 1))} aria-label="Next month">›</button>
        </div>
      </div>
      {!me ? <div className="meta" style={{ marginTop: 8 }}>{d ? "No record." : "Loading…"}</div> : (<>
        <div className="myatt-stats">
          {stat(me.present, "Days present", "#16a34a")}{stat(me.late, "Late", "#d97706")}{stat(me.absent, "Absent", "#dc2626")}{stat(me.leave, "Leave", "#7c3aed")}{stat(`₹${me.fine_total}`, "Fines", "#b91c1c")}
        </div>
        <LateAsk />
        {me.shift && <div className="myatt-shift"><b>Today's shift</b><span>{me.shift}</span></div>}
        {d.upcoming?.some((u) => u.label) && <div className="myatt-up">{d.upcoming.map((u) => <div key={u.date} className={"myatt-upd" + (u.label ? "" : " off")}><b>{new Date(u.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" })}</b><span>{u.label ? u.label.replace(/ AM/g, "a").replace(/ PM/g, "p") : "Off"}</span></div>)}</div>}
        <div className="myatt-days">
          {me.days.map((st, i) => {
            const t = me.times[i];
            return (
              <div key={i} className="myatt-day" title={st ? NAME[st] : ""}>
                <span className="myatt-n">{i + 1}</span>
                <span className="myatt-dot" style={{ background: st ? COLOR[st] : "#e5e7eb" }}>{st}</span>
                <span className="myatt-t">{t ? `${t.i || "–"}${t.o ? "→" + t.o : ""}` : ""}</span>
              </div>);
          })}
        </div>
      </>)}
    </div>
  );
}
