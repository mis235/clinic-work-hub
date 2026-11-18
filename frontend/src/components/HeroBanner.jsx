import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import { givenName } from "../givenName.js";
import Doll, { doll } from "./Doll.jsx";

const PERIOD_ICON = { morning: "sun", afternoon: "sun", evening: "sunset" };

// The pink banner at the top of every dashboard: greeting for the time of day, a line to start the day,
// and whatever is being celebrated today (birthdays, events). Icons are the app's own set.
export default function HeroBanner({ user, children }) {
  const [b, setB] = useState(null), [bd, setBd] = useState([]);
  useEffect(() => {
    const load = () => { api.banner().then(setB).catch(() => {}); api.leaveOverview().then((o) => setBd(o?.birthdaysToday || [])).catch(() => {}); };
    load(); const t = setInterval(load, 15 * 60000); return () => clearInterval(t);
  }, []);
  useEffect(() => { // wave once after signing in
    if (b && sessionStorage.getItem("doll_welcome")) { sessionStorage.removeItem("doll_welcome"); doll("welcome", 3600); }
  }, [b]);
  const hour = Number(new Date(Date.now() + 19800000).toISOString().slice(11, 13));
  const mood = !b ? "thinking" : bd.length ? "happy" : hour >= 22 || hour < 5 ? "sleepy" : "idle";
  const first = user?.role === "staff" ? givenName(user?.name) : ""; // names only on staff logins
  const celebrate = [
    ...bd.map((x) => ({ k: "b" + x.id, icon: "cake", text: x.id === user?.id ? "Happy birthday to you!" : `${x.name}'s birthday` })),
    ...(b?.events || []).map((e, i) => ({ k: "e" + i, icon: e.type === "holiday" ? "flag" : "star", text: e.title })),
  ];
  return (
    <div className="hero">
      <Doll mood={mood} size={215} className="hero-lumi" userId={user?.id} />
      <div className="hero-body">
        <div className="hero-greet"><Icon name={PERIOD_ICON[b?.period] || "sun"} size={18} /><h2>{b?.greeting || "Welcome"}{first ? `, ${first}` : ""}</h2></div>
        {b?.quote && <p className="hero-quote"><Icon name="quote" size={16} className="hq" />{b.quote}</p>}
        {celebrate.length > 0 && <div className="hero-chips">{celebrate.map((c) => <span key={c.k} className="hero-chip"><Icon name={c.icon} size={14} />{c.text}</span>)}</div>}
        {children && <div className="hero-actions">{children}</div>}
      </div>
      <svg className="hero-plant" viewBox="0 0 120 150" width="112" height="140" aria-hidden="true">
        <path d="M60 96 C40 80 34 52 48 30 C58 46 66 70 60 96Z" fill="#5FB88A" /><path d="M60 96 C82 82 92 58 80 34 C68 50 58 72 60 96Z" fill="#7DCB9F" />
        <path d="M60 98 C34 94 18 76 20 56 C40 60 56 76 60 98Z" fill="#4FA77A" /><path d="M60 98 C88 96 104 80 102 60 C82 62 64 78 60 98Z" fill="#66BD90" />
        <path d="M30 100 H90 L82 142 Q81 146 76 146 H44 Q39 146 38 142Z" fill="#EBDCC8" /><rect x="26" y="94" width="68" height="12" rx="6" fill="#F4E8D6" />
      </svg>
    </div>
  );
}
