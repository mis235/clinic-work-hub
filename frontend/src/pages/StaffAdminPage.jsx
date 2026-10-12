import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { navItemsFor } from "../navItems.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import StaffEditModal from "../components/StaffEditModal.jsx";
import Icon, { initials } from "../components/Icon.jsx";

export default function StaffAdminPage({ user, onLogout, onBack, onOpenProfile }) {
  const [roster, setRoster] = useState(null);
  const [shiftRoles, setShiftRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [dept, setDept] = useState("All");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listRosterFull().then(setRoster).catch(() => setRoster([]));
  useEffect(() => { refresh(); api.listShiftRoles().then(setShiftRoles).catch(() => setShiftRoles([])); }, []);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const depts = useMemo(() => ["All", ...new Set((roster || []).map((s) => s.department).filter(Boolean))], [roster]);
  const managers = (roster || []).filter((r) => r.role === "admin" || r.role === "manager").map((r) => r.name);
  const shown = (roster || []).filter((s) => (dept === "All" || s.department === dept) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Staff" onSelect={(item) => item !== "Staff" && onBack(item)}
        who={`${user.name} · Admin`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="Staff" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head row">
          <div>
            <div className="eyebrow">People</div>
            <h1>Staff Directory</h1>
            <p>Everyone on the team in one place — contact details, designation, reporting line and shift checklist role. Use Staff Onboarding to add new people or collect documents.</p>
          </div>
          <input className="field" style={{ width: 240 }} placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="pill-row">
          {depts.map((d) => <button key={d} className={`pill ${dept === d ? "active" : ""}`} onClick={() => setDept(d)}>{d}</button>)}
        </div>

        {roster === null && <div className="empty">Loading…</div>}
        {roster && shown.length === 0 && <div className="empty">No staff found.</div>}
        <div className="grid-2">
          {shown.map((s) => {
            const realPhone = s.phone && !s.phone.startsWith("+9190000200");
            return (
              <div key={s.id} className="card" style={{ marginBottom: 0 }}>
                <div className="person-row">
                  <div className="avatar" style={{ width: 46, height: 46 }}>{initials(s.name)}</div>
                  <div className="info">
                    <div className="nm"><span className="link" onClick={() => onOpenProfile(s.id)}>{s.name}</span></div>
                    <div className="sub">
                      {s.designation || "No designation"}
                      {s.designation && s.designation.includes("confirm") && <span style={{ color: "var(--red)" }}> — needs confirming</span>}
                    </div>
                  </div>
                  <span className={`badge ${s.role === "admin" ? "accepted" : s.role === "manager" ? "sent" : "pending"}`} style={{ textTransform: "capitalize" }}>{s.role}</span>
                </div>
                <div style={{ marginTop: 14 }}>
                  <span className="chip">{s.department || "No department"}</span>
                  {s.employee_code && <span className="chip">{s.employee_code}</span>}
                  {s.employment_type && <span className="chip">{s.employment_type}</span>}
                  <span className={`chip ${realPhone ? "" : "warn"}`}>{realPhone ? s.phone : "placeholder phone"}</span>
                  {!s.email && <span className="chip warn">no email</span>}
                </div>
                <div className="meta" style={{ marginTop: 6 }}>
                  Shift checklist: <strong style={{ color: "var(--ink)" }}>{s.shift_role || "none assigned"}</strong>
                  {s.reporting_to && <> · Reports to <strong style={{ color: "var(--ink)" }}>{s.reporting_to}</strong></>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => onOpenProfile(s.id)}>View profile</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>Edit details</button>
                </div>
              </div>
            );
          })}
        </div>

        {toast && <div className="toast">{toast}</div>}
        {editing && (
          <StaffEditModal staff={editing} shiftRoles={shiftRoles} managers={managers} onClose={() => setEditing(null)}
            onSave={async (payload) => {
              try { await api.updateUser(editing.id, payload); flash(`Updated ${editing.name}.`); } catch (e) { flash(e.message); }
              refresh();
            }} />
        )}
      </main>
    </div>
  );
}
