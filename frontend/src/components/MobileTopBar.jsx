import { useEffect } from "react";
import Icon from "./Icon.jsx";
import { NAV } from "../navItems.js";
export default function MobileTopBar({ title, onOpenMenu }) {
  useEffect(() => { const f = () => onOpenMenu?.(); window.addEventListener("open-menu", f); return () => window.removeEventListener("open-menu", f); }, [onOpenMenu]);
  return (
    <div className="mobile-topbar">
      <button className="hamburger-btn" onClick={onOpenMenu} aria-label="Open menu"><Icon name="menu" size={18} /></button>
      <div style={{ fontWeight: 800, fontSize: 16 }}>{NAV[title]?.label || title}</div>
    </div>
  );
}
