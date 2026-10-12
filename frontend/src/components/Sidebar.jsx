import { NAV, NAV_GROUPS } from "../navItems.js";
import Icon, { initials } from "./Icon.jsx";

export default function Sidebar({ items, active, onSelect, who, onLogout, mobileOpen, onCloseMobile, badges = {} }) {
  const [name, ...rest] = (who || "").split(" · ");
  return (
    <>
      <div className={`sidebar-backdrop ${mobileOpen ? "open" : ""}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/logo.png" alt="" className="sidebar-logo" />
          <div>
            Work Hub
            <small>DR. NISHITA'S CLINIC</small>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          {NAV_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => items.includes(k));
            if (keys.length === 0) return null;
            return (
              <div key={g.title}>
                <div className="nav-group-label">{g.title}</div>
                {keys.map((k) => (
                  <button key={k} className={active === k ? "active" : ""} onClick={() => { onSelect(k); onCloseMobile?.(); }}>
                    <Icon name={NAV[k]?.icon || "list"} size={18} />
                    <span>{NAV[k]?.label || k}</span>
                    {badges[k] > 0 && <span className="nav-count">{badges[k]}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{initials(name)}</div>
          <div className="who">{name}<small>{rest.join(" · ")}</small></div>
          <button onClick={onLogout} title="Sign out" aria-label="Sign out"><Icon name="logout" size={18} /></button>
        </div>
      </aside>
    </>
  );
}
