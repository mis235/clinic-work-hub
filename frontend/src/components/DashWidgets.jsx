import { useEffect, useState } from "react";
import { api, photoUrl } from "../api.js";
import Icon, { initials } from "./Icon.jsx";
import Pose from "./Pose.jsx";

const BAR_COLORS = ["#9C7FEA", "#F58AA5", "#FFB45E", "#F6D55C", "#6FD0A5", "#6FA8F5", "#B9A0F0"];
const istDate = (offsetDays = 0) => new Date(Date.now() + 19800000 - offsetDays * 86400000).toISOString().slice(0, 10);

// One pastel tile: coloured icon, label, big number, small line.
export function Kpi({ icon, tone, value, label, hint, good }) {
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-top"><div className={`kpi-ico ${tone}`}><Icon name={icon} size={19} /></div><div className="label">{label}</div></div>
      <div className="value">{value}</div>
      {hint && <div className={`hint ${good ? "good" : ""}`}>{hint}</div>}
    </div>
  );
}

// Last seven days of checklist completion, as soft coloured bars.
export function WeekBars({ trend = [], title = "Work overview" }) {
  const days = [6, 5, 4, 3, 2, 1, 0].map((o) => {
    const date = istDate(o), row = trend.find((r) => r.date === date);
    return { date, v: row ? row.completion_pct : null, label: new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }) };
  });
  return (
    <div className="card dw-card">
      <div className="dw-head"><div className="dw-title">{title}</div><span className="dw-pill">Last 7 days</span></div>
      <div className="wk">
        <div className="wk-y">{[100, 75, 50, 25, 0].map((v) => <span key={v}>{v}%</span>)}</div>
        <div className="wk-plot">
          <div className="wk-grid">{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</div>
          <div className="wk-bars">
            {days.map((d, i) => (
              <div className="wk-col" key={d.date} title={d.v == null ? `${d.label}: no data` : `${d.label}: ${d.v}%`}>
                <div className="wk-barbox">{d.v != null && <div className="wk-bar" style={{ height: `${Math.max(d.v, 3)}%`, background: BAR_COLORS[i], "--i": i }} />}</div>
                <span>{d.label}</span>
              </div>))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Where the tasks stand, as a ring with a small key.
export function StatusDonut({ counts = {}, title = "Task status" }) {
  const g = (k) => counts[k] || 0;
  const slices = [
    { label: "Done", n: g("done"), c: "#9C7FEA" },
    { label: "In progress", n: g("in_progress") + g("accepted"), c: "#5CCBAA" },
    { label: "Waiting", n: g("pending") + g("sent"), c: "#F6D55C" },
    { label: "Overdue", n: g("overdue"), c: "#F58AA5" },
    { label: "Other", n: g("extension_requested") + g("issue_reported"), c: "#6FA8F5" },
  ];
  const total = slices.reduce((a, s) => a + s.n, 0), R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="card dw-card">
      <div className="dw-head"><div className="dw-title">{title}</div></div>
      <div className="dn">
        <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Task status">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#EFE8FB" strokeWidth="22" />
          {total > 0 && slices.filter((s) => s.n > 0).map((s) => {
            const len = (s.n / total) * C, el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.c} strokeWidth="22" strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
            off += len; return el;
          })}
          <text x="70" y="68" textAnchor="middle" fontSize="24" fontWeight="700" fill="#2B2340">{total}</text>
          <text x="70" y="86" textAnchor="middle" fontSize="10.5" fill="#8A80A3">tasks</text>
        </svg>
        <ul className="dn-key">
          {slices.map((s) => <li key={s.label}><i style={{ background: s.c }} />{s.label}<b>{total ? Math.round((s.n / total) * 100) : 0}%</b></li>)}
        </ul>
      </div>
    </div>
  );
}

// Employee of the month, as a photo card.
export function EomCard({ canAnnounce, onNavigate }) {
  const [eom, setEom] = useState(null);
  useEffect(() => { const load = () => api.eom().then(setEom).catch(() => {}); load(); window.addEventListener("hub-refresh", load); return () => window.removeEventListener("hub-refresh", load); }, []);
  const cur = eom?.current;
  return (
    <div className="card dw-card">
      <div className="dw-head"><div className="dw-title">Employee of the month</div>{canAnnounce && <button className="dw-link" onClick={() => onNavigate?.("Events")}>{cur ? "Change" : "Announce"}</button>}</div>
      <div className="eom2">
        {cur?.hasPhoto ? <img src={photoUrl(cur.userId)} alt={cur.name} /> : <div className="eom2-blank">{cur ? initials(cur.name) : <Icon name="trophy" size={46} />}</div>}
        <div className="eom2-cap">
          <div><b>{cur ? cur.name : "Not announced yet"}</b>{cur && <small>{[cur.designation, cur.department].filter(Boolean).join(" · ")}</small>}</div>
          <span className="eom2-btn"><Icon name="trophy" size={18} /></span>
        </div>
      </div>
    </div>
  );
}

// The long bar at the bottom of the dashboard.
export function Strip({ title, sub, action, onClick }) {
  return (
    <div className="strip">
      <Pose pose="walk" size={74} />
      <div className="strip-txt"><b>{title}</b><small>{sub}</small></div>
      <button className="btn btn-primary" onClick={onClick}>{action}</button>
    </div>
  );
}
