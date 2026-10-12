import { useState } from "react";
import { navItemsFor } from "../navItems.js";
import Sidebar from "./Sidebar.jsx";
import MobileTopBar from "./MobileTopBar.jsx";

// Standard page frame (sidebar + mobile top bar). In the staff layout the parent already provides it, so just render the content.
export default function PageShell({ user, active, title, isStaffLayout, onLogout, onBack, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{children}</div>;
  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active={active}
        onSelect={(item) => item !== active && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title={title || active} onOpenMenu={() => setMobileOpen(true)} />
        {children}
      </div>
    </div>
  );
}
