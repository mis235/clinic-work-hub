import Avatar from "../components/Avatar.jsx";
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
              <Avatar id={d.id} name={d.name} hasPhoto={!!d.has_photo} size={104} className="xl-photo" />
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
              ) : <div className="meta">No salary details yet.</div>}
            </div>
          )}
          {tab === "pay" && p.payroll && <PayBankCard staffId={p.details?.id || staffId} profile={p.payroll.profile} canEdit={isAdmin || !!user.isHr} onSaved={load} />}

          <div style={{ display: tab === "overview" || tab === "activity" ? "block" : "none" }}>
          {tab === "overview" && !isStaffLayout && p.missing.length > 0 && (
            <div className="note warn">Still needed for this record: {p.missing.join(", ")}. {isAdmin ? "Use “Edit details” or the Documents tab." : ""}</div>
          )}
          <div className="kpi-grid">
            <Stat icon="clipboard" tone="green" num={p.shiftChecklist.avgCompletionPct === null ? "—" : `${p.shiftChecklist.avgCompletionPct}%`} label="Shift checklist average (30 days)" />
            <Stat icon="tasks" tone="blue" num={p.tasks.completionRate === null ? "—" : `${p.tasks.completionRate}%`} label="Task completion" />
            <Stat icon="alert" tone={p.tasks.overdue ? "red" : "green"} num={p.tasks.overdue} label="Overdue tasks" />
            {!isStaffLayout && <Stat icon="calendarCheck" tone="violet" num={p.attendance.daysPresentLast30} label="Days present (30 days)" />}
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
              {!isStaffLayout && <Row k="Last In Time" v={p.attendance.lastCheckIn ? new Date(p.attendance.lastCheckIn + "Z").toLocaleString() : "None yet"} />}
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><div className="name">Personal & emergency</div></div>
              <Row k="Mobile / WhatsApp" v={d.phone} />
              <Row k="Alternate number" v={d.alt_phone} />
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


const TYPE = { monthly: "Monthly salary", daily: "Per day", hourly: "Per hour" };
const mask = (a) => (a ? "•••• " + String(a).slice(-4) : "");
function PayBankCard({ staffId, profile, canEdit, onSaved }) {
  const pr = profile || {};
  const blank = () => ({ payType: pr.pay_type || "monthly", payRate: pr.pay_rate ?? "", pan: pr.pan || "", bankName: pr.bank_name || "", accountHolder: pr.account_holder || "", accountNumber: pr.account_number || "", ifsc: pr.ifsc || "", branch: pr.branch || "" });
  const [edit, setEdit] = useState(false), [f, setF] = useState(blank), [err, setErr] = useState(""), [show, setShow] = useState(false);
  useEffect(() => setF(blank()), [profile]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { setErr(""); try { await api.savePayDetails(staffId, f); setEdit(false); onSaved?.(); } catch (e) { setErr(e.message); } };
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head" style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="name">Pay & bank details</div>
        {canEdit && !edit && <button className="btn btn-primary btn-sm" onClick={() => setEdit(true)}>{pr.bank_name || pr.account_number ? "Edit" : "Add details"}</button>}
      </div>
      {!edit ? (
        <>
          <Row k="Pay type" v={TYPE[pr.pay_type] || ""} />
          <Row k={pr.pay_type === "daily" ? "Pay rate (per day)" : pr.pay_type === "hourly" ? "Pay rate (per hour)" : "Pay rate (per month)"} v={pr.pay_rate != null ? `₹${Number(pr.pay_rate).toLocaleString("en-IN")}` : ""} />
          <Row k="PAN number" v={pr.pan} />
          <Row k="Bank" v={pr.bank_name} />
          <Row k="Account holder" v={pr.account_holder} />
          <Row k="Account number" v={pr.account_number ? (show ? pr.account_number : mask(pr.account_number)) : ""} />
          <Row k="IFSC code" v={pr.ifsc} />
          <Row k="Branch" v={pr.branch} />
          {pr.account_number && <button className="btn btn-ghost btn-sm" onClick={() => setShow(!show)}>{show ? "Hide account number" : "Show account number"}</button>}
          {!pr.bank_name && !pr.account_number && !pr.pan && <div className="meta">{canEdit ? "Not added yet. Press Add details." : "Not added yet. Ask HR to add them."}</div>}
        </>
      ) : (
        <div style={{ display: "grid", gap: 8, maxWidth: 460 }}>
          <label className="field-label">Pay type</label>
          <select className="field" value={f.payType} onChange={set("payType")}><option value="monthly">Monthly salary</option><option value="daily">Per day</option><option value="hourly">Per hour</option></select>
          <label className="field-label">Pay rate (₹ {f.payType === "daily" ? "per day" : f.payType === "hourly" ? "per hour" : "per month"})</label>
          <input className="field" type="number" min="0" value={f.payRate} onChange={set("payRate")} />
          <label className="field-label">PAN number</label><input className="field" value={f.pan} onChange={set("pan")} placeholder="ABCDE1234F" maxLength={10} />
          <label className="field-label">Bank name</label><input className="field" value={f.bankName} onChange={set("bankName")} />
          <label className="field-label">Account holder name</label><input className="field" value={f.accountHolder} onChange={set("accountHolder")} />
          <label className="field-label">Account number</label><input className="field" inputMode="numeric" value={f.accountNumber} onChange={set("accountNumber")} />
          <label className="field-label">IFSC code</label><input className="field" value={f.ifsc} onChange={set("ifsc")} placeholder="HDFC0001234" maxLength={11} />
          <label className="field-label">Branch</label><input className="field" value={f.branch} onChange={set("branch")} />
          {err && <div className="note warn">{err}</div>}
          <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary btn-sm" onClick={save}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => { setEdit(false); setF(blank()); setErr(""); }}>Cancel</button></div>
        </div>
      )}
    </div>);
}
