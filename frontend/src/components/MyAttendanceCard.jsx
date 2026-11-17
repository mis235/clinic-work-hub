import { useEffect, useState } from "react";
import { api } from "../api.js";

const istMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);
const shift = (m, n) => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
const COLOR = { P: "#16a34a", L: "#d97706", H: "#0ea5e9", LV: "#7c3aed", A: "#dc2626", W: "#9ca3af" };
const NAME = { P: "Present", L: "Late", H: "Half day", LV: "Leave", A: "Absent", W: "Week off" };

// A staff member's own attendance for the month: login and logout times, late count, fines.
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
