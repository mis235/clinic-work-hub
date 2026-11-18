import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import Avatar from "./Avatar.jsx";
import GirlFace from "./GirlFace.jsx";
import NotificationBell from "./NotificationBell.jsx";
import { NAV, navItemsFor } from "../navItems.js";
import { getTheme, setTheme } from "../theme.js";

// The bar at the top of every page: page name, search, the bell and your picture.
export default function MobileTopBar({ title, onOpenMenu }) {
  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }, []);
  const [theme, setT] = useState(getTheme());
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), box = useRef(null);
  useEffect(() => { const f = () => onOpenMenu?.(); window.addEventListener("open-menu", f); return () => window.removeEventListener("open-menu", f); }, [onOpenMenu]);
  useEffect(() => { const f = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  const label = (k) => NAV[k]?.label || k;
  const term = q.trim().toLowerCase();
  const hits = term && user ? navItemsFor(user).filter((k) => label(k).toLowerCase().includes(term)).slice(0, 7) : [];
  const go = (k) => { window.dispatchEvent(new CustomEvent("hub-nav", { detail: k })); setQ(""); setOpen(false); };
  return (
    <header className="topbar">
      <button className="hamburger-btn" onClick={onOpenMenu} aria-label="Open menu"><Icon name="menu" size={18} /></button>
      <h1 className="topbar-title">{label(title)}</h1>
      <div className="topbar-search" ref={box}>
        <Icon name="search" size={17} />
        <input value={q} placeholder="Search pages…" aria-label="Search pages"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0]); if (e.key === "Escape") setOpen(false); }} />
        {open && term && (
          <div className="topbar-drop">
            {hits.length === 0 && <div className="topbar-none">Nothing found</div>}
            {hits.map((k) => <button key={k} onClick={() => go(k)}><Icon name={NAV[k]?.icon || "list"} size={16} />{label(k)}</button>)}
          </div>)}
      </div>
      <div className="theme-dots" role="group" aria-label="Colour theme">{[["lavender", "Lavender"], ["peach", "Peach and mint"]].map(([k, l]) => <button key={k} className={`td-${k} ${theme === k ? "on" : ""}`} title={l} aria-label={l} aria-pressed={theme === k} onClick={() => { setTheme(k); setT(k); }} />)}</div>
      <NotificationBell />
      {user?.id && <button className="topbar-me" onClick={() => go("My Profile")} aria-label="My profile"><Avatar id={user.id} name={user.name} size={42} fallback={<GirlFace size={42} />} /></button>}
    </header>
  );
}
