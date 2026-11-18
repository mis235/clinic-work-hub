import Avatar from "./Avatar.jsx";
import { NAV, NAV_GROUPS } from "../navItems.js";
import { givenName } from "../givenName.js";
import GirlFace from "./GirlFace.jsx";
import Icon, { initials } from "./Icon.jsx";

const SHORT = { Dashboard: "Home", "My checklist": "Tasks", "Shift Checklist": "Shift", Attendance: "Attendance", Help: "Help", Leave: "Leave" };
const savedId = () => { try { return JSON.parse(localStorage.getItem("user") || "null")?.id; } catch { return null; } };

export default function Sidebar({ items, active, onSelect, who, me, onLogout, mobileOpen, onCloseMobile, badges = {} }) {
  const [name] = (who || "").split(" · ");
  const isStaff = (() => { try { return JSON.parse(localStorage.getItem("user") || "null")?.role === "staff"; } catch { return false; } })();
  const first = isStaff ? givenName(name) : "";
  const meId = me?.id ?? savedId();
  const go = (k) => { onSelect(k); onCloseMobile?.(); };
  const groups = NAV_GROUPS.map((g) => g.keys.filter((k) => items.includes(k))).filter((k) => k.length);
  return (
    <>
      <div className={`sidebar-backdrop ${mobileOpen ? "open" : ""}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <button className="side-me" onClick={() => go("My Profile")} aria-label="My profile">
          <span className="side-ring">{meId ? <Avatar id={meId} name={name} size={78} fallback={<GirlFace size={78} />} /> : <GirlFace size={78} />}</span>
          <span className="side-hi">{first ? `Hi, ${first}` : "Hi there"} <Icon name="wave" size={17} /></span>
        </button>
        <nav className="sidebar-nav" aria-label="Main">
          {groups.map((keys, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="nav-sep" />}
              {keys.map((k) => (
                <button key={k} className={active === k ? "active" : ""} onClick={() => go(k)}>
                  <Icon name={NAV[k]?.icon || "list"} size={19} />
                  <span>{NAV[k]?.label || k}</span>
                  {badges[k] > 0 && <span className="nav-count">{badges[k]}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {items.includes("Help") && (
          <div className="side-promo">
            <span className="crown"><Icon name="chat" size={22} /></span>
            <b>Need help?</b>
            <small>Ask the admin team</small>
            <button onClick={() => go("Help")}>Open Help desk</button>
          </div>
        )}
        <button className="side-out" onClick={onLogout}><Icon name="logout" size={16} /> Sign out</button>
      </aside>
      <nav className="bottom-nav" aria-label="Quick menu">
        {["Dashboard", "My checklist", "Shift Checklist", "Attendance", "Help", "Leave"].filter((k) => items.includes(k)).slice(0, 4).map((k) => (
          <button key={k} className={active === k ? "active" : ""} onClick={() => onSelect(k)} aria-label={NAV[k]?.label || k}>
            <Icon name={NAV[k]?.icon || "list"} size={19} /><span>{SHORT[k] || NAV[k]?.label || k}</span>
          </button>
        ))}
        <button onClick={() => window.dispatchEvent(new Event("open-menu"))} aria-label="More"><Icon name="menu" size={19} /><span>More</span></button>
      </nav>
    </>
  );
}
