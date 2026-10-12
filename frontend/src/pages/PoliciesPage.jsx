import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function PoliciesPage({ user, isStaffLayout, onLogout, onBack }) {
  const [policies, setPolicies] = useState(null);
  const [open, setOpen] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listPolicies().then(setPolicies).catch(() => setPolicies([]));
  useEffect(() => { refresh(); }, []);

  async function acknowledge(id) {
    await api.acknowledgePolicy(id);
    refresh();
  }

  const unread = policies?.filter((p) => !p.acknowledgedByMe).length || 0;

  const body = (
    <>
      <div className="page-head">
        <h1>Policies & SOPs</h1>
        <p>{unread > 0 ? `${unread} ${unread === 1 ? "policy needs" : "policies need"} your acknowledgment.` : "You're up to date on all current policies."}</p>
      </div>

      {policies === null && <div className="empty">Loading…</div>}

      {policies?.map((p) => (
        <div key={p.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)", marginLeft: 8 }}>{p.category} · v{p.version}</span>
            </div>
            <span className={`badge ${p.acknowledgedByMe ? "done" : "sent"}`}>{p.acknowledgedByMe ? "Acknowledged" : "Needs review"}</span>
          </div>
          {open === p.id && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, margin: 0 }}>{p.body}</pre>
              {!p.acknowledgedByMe && (
                <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={() => acknowledge(p.id)}>I've read this</button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );

  if (isStaffLayout) {
    // Rendered inline within the staff dashboard's existing sidebar shell
    return <div style={{ marginTop: 8 }}>{body}</div>;
  }

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Policies"
        onSelect={(item) => item !== "Policies" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Policies" onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </div>
    </div>
  );
}
