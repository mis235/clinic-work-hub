import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { navItemsFor } from "../navItems.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import StaffEditModal from "../components/StaffEditModal.jsx";
import Icon, { initials } from "../components/Icon.jsx";

const DEPTS = ["Management", "Front Desk", "Therapist", "MDO", "Doctors", "Pharmacy", "Floor Coordinator", "Finance", "Supporting Staff"];

export default function StaffAdminPage({ user, onLogout, onBack, onOpenProfile }) {
  const [roster, setRoster] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [shiftRoles, setShiftRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [dept, setDept] = useState("All");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listRosterAll().then(setRoster).catch(() => setRoster([]));
  useEffect(() => { refresh(); api.listShiftRoles().then(setShiftRoles).catch(() => setShiftRoles([])); }, []);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  async function remove(s) {
    if (!window.confirm(`Remove ${s.name}? They will no longer be able to sign in. Their past records are kept and you can restore them later.`)) return;
    try { await api.removeStaff(s.id); flash(`${s.name} removed.`); } catch (e) { flash(e.message); }
    refresh();
  }

  const depts = useMemo(() => ["All", ...new Set((roster || []).filter((s) => s.active).map((s) => s.department).filter(Boolean))], [roster]);
  const allDepts = useMemo(() => [...new Set([...DEPTS, ...(roster || []).map((s) => s.department).filter(Boolean)])], [roster]);
  const removedCount = (roster || []).filter((s) => !s.active).length;
  const managers = (roster || []).filter((r) => r.active && (r.role === "admin" || r.role === "manager")).map((r) => r.name);
  const shown = (roster || []).filter((s) => (showRemoved ? !s.active : !!s.active) && (dept === "All" || s.department === dept) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));

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
            <p>Everyone on the team in one place — contact details, designation, reporting line and shift checklist role. Add new people, edit anyone’s details, or remove someone who has left (their history is kept).</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="field" style={{ width: 200 }} placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="userplus" size={16} /> Add staff</button>
          </div>
        </div>

        <div className="pill-row">
          {removedCount > 0 && <button className={`pill ${showRemoved ? "active" : ""}`} onClick={() => setShowRemoved((x) => !x)}>{showRemoved ? "← Back to active staff" : `Removed staff (${removedCount})`}</button>}
          {!showRemoved && depts.map((d) => <button key={d} className={`pill ${dept === d ? "active" : ""}`} onClick={() => setDept(d)}>{d}</button>)}
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
                  {s.active
                    ? <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>Edit details</button>
                        {s.id !== user.id && <button className="btn btn-ghost btn-sm" onClick={() => remove(s)}>Remove</button>}
                      </>
                    : <button className="btn btn-outline btn-sm" onClick={async () => { await api.restoreStaff(s.id); flash(`${s.name} restored.`); refresh(); }}>Restore</button>}
                </div>
              </div>
            );
          })}
        </div>

        {toast && <div className="toast">{toast}</div>}
        {adding && <AddStaffModal departments={allDepts} shiftRoles={shiftRoles} onClose={() => setAdding(false)}
          onDone={(m) => { setAdding(false); flash(m); refresh(); }} />}
        {editing && (
          <StaffEditModal staff={editing} shiftRoles={shiftRoles} managers={managers} departments={allDepts} onClose={() => setEditing(null)}
            onSave={async (payload) => {
              try { await api.updateUser(editing.id, payload); flash(`Updated ${editing.name}.`); setEditing(null); } catch (e) { flash(e.message); }
              refresh();
            }} />
        )}
      </main>
    </div>
  );
}

function AddStaffModal({ departments, shiftRoles, onClose, onDone }) {
  const [f, setF] = useState({ name: "", departmentName: departments[0] || "Front Desk", roleName: "staff", phone: "", email: "", designation: "", shiftRole: "", joinedAt: "", pin: "1234" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true); setErr("");
    try {
      await api.createStaff({ ...f, name: f.name.trim(), shiftRole: f.shiftRole || undefined, email: f.email || undefined, joinedAt: f.joinedAt || undefined, designation: f.designation || undefined });
      onDone(`${f.name} added. They sign in with their name and PIN ${f.pin}, then choose their own PIN.`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Add a staff member</h3>
        <div className="form-grid">
          <div><label className="field-label">Full name *</label><input className="field" value={f.name} onChange={set("name")} /></div>
          <div><label className="field-label">Mobile number *</label><input className="field" value={f.phone} onChange={set("phone")} placeholder="+91XXXXXXXXXX" /></div>
          <div><label className="field-label">Department *</label><select className="field" value={f.departmentName} onChange={set("departmentName")}>{departments.map((d) => <option key={d}>{d}</option>)}</select></div>
          <div><label className="field-label">Access level</label><select className="field" value={f.roleName} onChange={set("roleName")}><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>
          <div><label className="field-label">Designation</label><input className="field" value={f.designation} onChange={set("designation")} /></div>
          <div><label className="field-label">Email</label><input className="field" type="email" value={f.email} onChange={set("email")} /></div>
          <div><label className="field-label">Date of joining</label><input className="field" type="date" value={f.joinedAt} onChange={set("joinedAt")} /></div>
          <div><label className="field-label">Shift checklist role</label><select className="field" value={f.shiftRole} onChange={set("shiftRole")}><option value="">— None —</option>{shiftRoles.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><label className="field-label">Starting PIN (4 digits)</label><input className="field" maxLength={4} value={f.pin} onChange={set("pin")} /></div>
        </div>
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.phone.trim() || !/^\d{4}$/.test(f.pin)} onClick={save}>{busy ? "Adding…" : "Add staff"}</button></div>
      </div>
    </div>
  );
}
