import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Icon, { initials } from "../components/Icon.jsx";
import StaffDocuments from "../components/StaffDocuments.jsx";
import StaffEditModal from "../components/StaffEditModal.jsx";

function pctClass(p) {
  if (p === null || p === undefined) return "pending";
  return p >= 90 ? "done" : p >= 60 ? "pending" : "issue";
}

function Stat({ num, label, tone = "teal", icon }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><div className={`kpi-ico ${tone}`}><Icon name={icon} size={19} /></div></div>
      <div className="value">{num}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function Row({ k, v }) {
  const empty = v === null || v === undefined || v === "";
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v ${empty ? "missing" : ""}`}>{empty ? "Not set" : v}</span>
    </div>
  );
}

// staffId: a user id, or "me". Dual-mode like the other pages: isStaffLayout renders inline inside StaffDashboard.
export default function StaffProfilePage({ user, staffId, isStaffLayout, onLogout, onBack, backLabel = "Staff" }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [shiftRoles, setShiftRoles] = useState([]);
  const [roster, setRoster] = useState([]);
  const isAdmin = user.role === "admin";

  const load = () => api.getStaffProfile(staffId).then(setP).catch((e) => setError(e.message));
  useEffect(() => { setP(null); setTab("overview"); load(); }, [staffId]);
  useEffect(() => {
    if (!isAdmin) return;
    api.listShiftRoles().then(setShiftRoles).catch(() => {});
    api.listRosterFull().then(setRoster).catch(() => {});
  }, [isAdmin]);

  const d = p?.details;
  const body = (
    <>
      {!isStaffLayout && (
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => onBack(backLabel)}><Icon name="back" size={15} /> Back</button>
      )}
      {error && <div className="empty">{error}</div>}
      {editing && p && (
        <StaffEditModal staff={p.details} shiftRoles={shiftRoles} managers={roster.filter((r) => r.role === "admin" || r.role === "manager").map((r) => r.name)}
          departments={[...new Set(roster.map((r) => r.department).filter(Boolean))]} onClose={() => setEditing(false)}
          onSave={async (payload) => { try { await api.updateUser(staffId, payload); await load(); } catch (e) { setError(e.message); } }} />
      )}
      {!p && !error && <div className="empty">Loading…</div>}
      {p && (
        <>
          <div className="profile-hero">
            <div className="banner" />
            <div className="body">
              <div className="avatar xl">{initials(d.name)}</div>
              <div className="who">
                <h1>{d.name}</h1>
                <div className="sub">{d.designation || "No designation set"} · {d.department}</div>
                <div style={{ marginTop: 10 }}>
                  <span className="badge teal" style={{ marginRight: 6, textTransform: "capitalize" }}>{d.role}</span>
                  {d.employee_code && <span className="chip">{d.employee_code}</span>}
                  {d.employment_type && <span className="chip">{d.employment_type}</span>}
                  {d.active ? <span className="badge done">Active</span> : <span className="badge issue">Removed</span>}
                </div>
              </div>
              <div className="actions">
                {d.phone && <a className="btn btn-outline btn-sm" href={`tel:${d.phone}`}>Call</a>}
                {d.phone && <a className="btn btn-outline btn-sm" href={`https://wa.me/${d.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                {d.email && <a className="btn btn-outline btn-sm" href={`mailto:${d.email}`}>Email</a>}
                {isAdmin && !isStaffLayout && <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Edit details</button>}
              </div>
            </div>
          </div>

          <div className="tabs">
            {[["overview", "Overview"], ["documents", "Documents"], ["activity", "Work & activity"], ...(p.payroll ? [["pay", "Pay"]] : [])].map(([k, label]) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === "documents" && <StaffDocuments staffId={isStaffLayout ? "me" : staffId} onChanged={load} />}

          {tab === "pay" && p.payroll && (
            <div className="card">
              <div className="card-head"><div className="name">Payroll</div></div>
              {p.payroll.hasPayProfile ? (
                <>
                  <Row k="Company" v={p.payroll.profile.company} />
                  <Row k="Employee code" v={p.payroll.profile.employee_code} />
                  <Row k="Position on payslip" v={p.payroll.profile.position} />
                  <Row k="Basic salary (monthly)" v={`₹${Math.round(p.payroll.profile.basic_salary).toLocaleString("en-IN")}`} />
                  <div className="meta" style={{ margin: "14px 0 6px", fontWeight: 700 }}>Recent payslips</div>
                  {p.payroll.recentPayslips.length === 0 && <div className="meta">None generated yet.</div>}
                  {p.payroll.recentPayslips.map((s) => (
                    <div key={s.pay_period} className="kv"><span className="k">{s.pay_period}</span><span className="v">₹{Math.round(s.net_payable).toLocaleString("en-IN")}{s.emailed_at ? " · emailed" : ""}</span></div>
                  ))}
                </>
              ) : <div className="meta">No salary details yet. Add them from the Payroll page.</div>}
            </div>
          )}

          <div style={{ display: tab === "overview" || tab === "activity" ? "block" : "none" }}>
          {tab === "overview" && !isStaffLayout && p.missing.length > 0 && (
            <div className="note warn">Still needed for this record: {p.missing.join(", ")}. {isAdmin ? "Use “Edit details” or the Documents tab." : ""}</div>
          )}
          <div className="kpi-grid">
            <Stat icon="clipboard" tone="green" num={p.shiftChecklist.avgCompletionPct === null ? "—" : `${p.shiftChecklist.avgCompletionPct}%`} label="Shift checklist average (30 days)" />
            <Stat icon="tasks" tone="blue" num={p.tasks.completionRate === null ? "—" : `${p.tasks.completionRate}%`} label="Task completion" />
            <Stat icon="alert" tone={p.tasks.overdue ? "red" : "green"} num={p.tasks.overdue} label="Overdue tasks" />
            <Stat icon="calendarCheck" tone="violet" num={p.attendance.daysPresentLast30} label="Days present (30 days)" />
          </div>

          {tab === "overview" && <>
          <div className="grid-2">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><div className="name">Employment</div></div>
              <Row k="Designation" v={d.designation} />
              <Row k="Department" v={d.department} />
              <Row k="Employment type" v={d.employment_type} />
              <Row k="Reports to" v={d.reporting_to} />
              <Row k="Date of joining" v={d.joined_at ? `${d.joined_at}${d.tenureYears !== null ? ` (${d.tenureYears} yrs)` : ""}` : null} />
              <Row k="Shift checklist role" v={d.shift_role || "None assigned"} />
              <Row k="Last check-in" v={p.attendance.lastCheckIn ? new Date(p.attendance.lastCheckIn + "Z").toLocaleString() : "None yet"} />
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><div className="name">Personal & emergency</div></div>
              <Row k="Mobile / WhatsApp" v={d.phone} />
              <Row k="Email" v={d.email} />
              <Row k="Birthday" v={d.birthday} />
              <Row k="Gender" v={d.gender} />
              <Row k="Blood group" v={d.blood_group} />
              <Row k="Address" v={d.address} />
              <Row k="Emergency contact" v={d.emergency_contact_name ? `${d.emergency_contact_name}${d.emergency_contact_phone ? ` · ${d.emergency_contact_phone}` : ""}` : null} />
            </div>
          </div>
          {p.bio && <div className="card" style={{ marginTop: 16 }}><p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.65 }}><strong>{p.bio.title}.</strong> {p.bio.bio}</p></div>}
          </>}

          {tab === "activity" && <>
          <div className="section-head"><h2>Shift checklist — last 30 days</h2><span className="sub">{p.shiftChecklist.submissionsLast30} submitted · {p.shiftChecklist.daysSubmittedLast30} days · {p.shiftChecklist.withPhoto} with photo</span></div>
          <div className="card">
            {p.shiftChecklist.recent.length === 0 && <div className="meta">No shift checklists submitted yet.</div>}
            {p.shiftChecklist.recent.map((r) => (
              <div key={r.workDate + r.shift} className="task-row">
                <div>
                  <div className="title">{r.workDate} · {r.shift}</div>
                  <div className="meta">{r.completed}/{r.total} items{r.hasPhoto ? " · photo attached" : ""}</div>
                </div>
                <span className={`badge ${pctClass(r.completionPct)}`}>{r.completionPct}%</span>
              </div>
            ))}
          </div>

          <div className="section-head"><h2>Tasks</h2><span className="sub">{p.tasks.done} done · {p.tasks.open} open · {p.tasks.overdue} overdue</span></div>
          <div className="card">
            {p.tasks.recent.length === 0 && <div className="meta">No tasks assigned yet.</div>}
            {p.tasks.recent.map((t, i) => (
              <div key={i} className="task-row">
                <div>
                  <div className="title">{t.title}</div>
                  <div className="meta">{t.category}{t.due_date ? ` · due ${new Date(t.due_date).toLocaleDateString()}` : ""}</div>
                </div>
                <span className={`badge ${t.status === "done" ? "done" : "pending"}`}>{t.status.replace("_", " ")}</span>
              </div>
            ))}
          </div>

          <div className="grid-3">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><div className="name">Policies</div></div>
              <div className="meta">{p.policies.acknowledged} of {p.policies.total} acknowledged</div>
              <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${p.policies.total ? (p.policies.acknowledged / p.policies.total) * 100 : 0}%` }} /></div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><div className="name">Training</div></div>
              <div className="meta">{p.training.watched} of {p.training.total} videos watched</div>
              <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${p.training.total ? (p.training.watched / p.training.total) * 100 : 0}%` }} /></div>
            </div>
          </div>
          </>}
          </div>
        </>
      )}
    </>
  );

  if (isStaffLayout) return <div>{body}</div>;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active={backLabel}
        onSelect={(item) => onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="Profile" onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </main>
    </div>
  );
}
