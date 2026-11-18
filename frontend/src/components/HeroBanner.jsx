import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import Lumi from "./Lumi.jsx";

const PERIOD_ICON = { morning: "sun", afternoon: "sun", evening: "sunset" };

// The pink banner at the top of every dashboard: greeting for the time of day, a line to start the day,
// and whatever is being celebrated today (birthdays, events). Icons are the app's own set.
export default function HeroBanner({ user, children }) {
  const [b, setB] = useState(null), [bd, setBd] = useState([]);
  useEffect(() => {
    const load = () => { api.banner().then(setB).catch(() => {}); api.leaveOverview().then((o) => setBd(o?.birthdaysToday || [])).catch(() => {}); };
    load(); const t = setInterval(load, 15 * 60000); return () => clearInterval(t);
  }, []);
  const first = String(user?.name || "").replace(/^(dr\.?\s*)/i, "").split(" ")[0];
  const celebrate = [
    ...bd.map((x) => ({ k: "b" + x.id, icon: "cake", text: x.id === user?.id ? "Happy birthday to you!" : `${x.name}'s birthday` })),
    ...(b?.events || []).map((e, i) => ({ k: "e" + i, icon: e.type === "holiday" ? "flag" : "star", text: e.title })),
  ];
  return (
    <div className="hero">
      <Lumi mood="wave" size={118} className="hero-lumi" />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="hero-greet"><Icon name={PERIOD_ICON[b?.period] || "sun"} size={18} /><h2>{b?.greeting || "Welcome"}{first ? `, ${first}` : ""}</h2></div>
        {b?.quote && <p className="hero-quote"><Icon name="quote" size={16} className="hq" />{b.quote}</p>}
        {celebrate.length > 0 && <div className="hero-chips">{celebrate.map((c) => <span key={c.k} className="hero-chip"><Icon name={c.icon} size={14} />{c.text}</span>)}</div>}
        {children && <div className="hero-actions">{children}</div>}
      </div>
    </div>
  );
}
