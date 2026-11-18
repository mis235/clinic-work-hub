import Icon from "./Icon.jsx";
import { useEffect, useState } from "react";
import Avatar from "./Avatar.jsx";
import { api } from "../api.js";

const TYPE = { holiday: ["Holiday", "#b45309", "#fef3c7"], festival: ["Festival", "#be185d", "#fce7f3"], important_date: ["Important date", "#1d4ed8", "#dbeafe"], event: ["Event", "#6d28d9", "#ede9fe"] };
const dm = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const initials = (n) => String(n || "").split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

// What everyone in the clinic sees on their dashboard: this month's Employee of the Month and the next events and holidays.
export default function TeamBoard({ canAnnounce = false, onNavigate, hideEom = false }) {
  const [eom, setEom] = useState(null), [feed, setFeed] = useState(null);
  const load = () => { api.eom().then(setEom).catch(() => {}); api.eventsFeed().then(setFeed).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 60000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  const cur = hideEom ? null : eom?.current, items = feed?.items || [];
  if (!cur && items.length === 0 && (!canAnnounce || hideEom)) return null;
  return (
    <div className="team-board">
      {!cur && canAnnounce && !hideEom && (
        <div className="eom-card">
          <div className="eom-badge icon-h"><Icon name="trophy" size={15} /> Employee of the Month</div>
          <div className="eom-body"><div><div className="eom-name">Not announced yet</div></div><button className="btn btn-sm" style={{ marginLeft: "auto", background: "#fff" }} onClick={() => onNavigate?.("Events")}>Announce</button></div>
        </div>)}
      {cur && (
        <div className="eom-card">
          <div className="eom-badge icon-h"><Icon name="trophy" size={15} /> Employee of the Month · {cur.label}</div>
          <div className="eom-body">
            <Avatar id={cur.userId} name={cur.name} hasPhoto={cur.hasPhoto} size={84} className="eom-photo" />
            <div><div className="eom-name">{cur.name}</div><div className="eom-meta">{[cur.designation, cur.department].filter(Boolean).join(" · ")}</div>{cur.note && <div className="eom-note">“{cur.note}”</div>}</div>
          </div>
        </div>)}
      {items.length > 0 && (
        <div className="card ev-card">
          <div className="card-head"><div className="name">Events &amp; holidays</div></div>
          {items.slice(0, 5).map((e) => { const t = TYPE[e.eventType] || TYPE.event; return (
            <div key={e.id + e.date} className="ev-row">
              <div className="ev-date"><b>{e.date.slice(8)}</b><span>{new Date(e.date + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}</span></div>
              <div className="ev-main"><div className="title">{e.title}</div><div className="meta">{dm(e.date)}{e.inDays === 0 ? " · Today" : e.inDays === 1 ? " · Tomorrow" : ` · in ${e.inDays} days`}</div></div>
              <span className="ev-tag" style={{ color: t[1], background: t[2] }}>{t[0]}</span>
            </div>); })}
        </div>)}
    </div>);
}
