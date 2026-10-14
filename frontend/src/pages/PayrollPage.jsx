import { useEffect, useState } from "react";
import { api } from "../api.js";
import { navItemsFor } from "../navItems.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import TemplateStudio from "../components/TemplateStudio.jsx";

export default function PayrollPage({ user, onLogout, onBack }) {
  const [profiles, setProfiles] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [roster, setRoster] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [company, setCompany] = useState("all");
  const [editing, setEditing] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.listPayProfiles().then(setProfiles).catch(() => setProfiles([]));
  useEffect(() => {
    refresh();
    api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
    api.listRosterFull().then(setRoster).catch(() => setRoster([]));
  }, []);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3500); }

  async function generateFor(userId) {
    const period = new Date().toISOString().slice(0, 7);
    try {
      await api.generatePayroll({ period, userId, sendEmail: false });
      flash(`Payslip generated for ${period}. To email it, use Documents → Payslips → Email, after setting up email in System & Backups.`);
    } catch (e) { flash(e.message); }
  }

  async function runMonthlyNow() {
    try {
      const r = await api.runMonthlyPayrollNow();
      flash(`Ran payroll for all ${r.generated} employee(s) with a pay profile.`);
    } catch (e) { flash(e.message); }
  }

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Payroll"
        onSelect={(item) => item !== "Payroll" && onBack(item)}
        who={`${user.name} · Admin`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Payroll" onOpenMenu={() => setMobileOpen(true)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="page-head">
            <h1>Payroll</h1>
            <p>Real, multi-company payslip generation — {companies.length} companies on file.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={runMonthlyNow}>Run this month's payroll for everyone</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Set up an employee's pay</button>
          </div>
        </div>

        {profiles === null && <div className="empty">Loading…</div>}
        {profiles?.length === 0 && (
          <div className="note">
            Only Neelima has a real pay profile right now (from her actual payslip). Every other employee needs
            their salary structure entered before payroll can run for them — click "+ Set up an employee's pay" above.
          </div>
        )}

        <TemplateStudio kind="payslip" companies={companies} roster={roster} flash={flash} />

        <div className="section-head" style={{ marginTop: 24 }}><h2 style={{ fontSize: 15 }}>Salary details by company</h2></div>
        <div className="pill-row">
          <button className={`pill ${company === "all" ? "active" : ""}`} onClick={() => setCompany("all")}>All <span className="n">{profiles?.length || 0}</span></button>
          {companies.map((c) => <button key={c.id} className={`pill ${company === c.id ? "active" : ""}`} onClick={() => setCompany(c.id)}>{c.name} <span className="n">{(profiles || []).filter((p) => p.company_id === c.id).length}</span></button>)}
        </div>
        {profiles?.filter((p) => company === "all" || p.company_id === company).map((p) => (
          <div key={p.user_id} className="card">
            <div className="card-head">
              <div><span className="name">{p.name}</span><span className="dept">{p.employee_code || "no employee code"}</span></div>
              <span className="phone">{p.email || "no email on file — payslip can't be emailed yet"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8 }}>
              <span>Basic: ₹{p.basic_salary.toLocaleString("en-IN")} · Retention: ₹{p.retention.toLocaleString("en-IN")}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>Edit</button>
                <button className="btn-wa btn-sm" onClick={() => generateFor(p.user_id)}>PDF slip (this month)</button></span>
            </div>
          </div>
        ))}

        {toast && <div className="toast">{toast}</div>}
        {(showForm || editing) && (
          <ProfileForm
            initial={editing}
            key={editing?.user_id || "new"}
            roster={roster.filter((r) => r.role !== "admin")}
            companies={companies}
            onClose={() => { setShowForm(false); setEditing(null); }}
            onSave={async (p) => { await api.setPayProfile(p); refresh(); flash("Pay profile saved."); }}
          />
        )}
      </div>
    </div>
  );
}

function ProfileForm({ roster, companies, initial, onClose, onSave }) {
  const i = initial || {};
  const [userId, setUserId] = useState(i.user_id || roster[0]?.id || "");
  const [companyId, setCompanyId] = useState(i.company_id || companies[0]?.id || "");
  const [f, setF] = useState({
    employeeCode: i.employee_code || "", position: i.position || "", pan: i.pan || "",
    basicSalary: i.basic_salary ?? "", leaveBonus: i.leave_bonus ?? 0, overtime: i.overtime ?? 0, otherAllowances: i.other_allowances ?? 0,
    pf: i.pf ?? 0, tds: i.tds ?? 0, otherDeductions: i.other_deductions ?? 0, retention: i.retention ?? 0,
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (k, label) => (<div><label className="field-label">{label}</label><input className="field" type="number" value={f[k]} onChange={set(k)} /></div>);
  const gross = ["basicSalary", "leaveBonus", "overtime", "otherAllowances"].reduce((a, k) => a + Number(f[k] || 0), 0);
  const ded = ["pf", "tds", "otherDeductions", "retention"].reduce((a, k) => a + Number(f[k] || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? `Salary details — ${i.name}` : "Set up salary details"}</h3>
        <div className="form-grid">
          {!initial && <div><label className="field-label">Employee</label>
            <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>{roster.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.department}</option>)}</select></div>}
          <div><label className="field-label">Company (who pays this person)</label>
            <select className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="field-label">Employee code</label><input className="field" value={f.employeeCode} onChange={set("employeeCode")} /></div>
          <div><label className="field-label">Position on payslip</label><input className="field" value={f.position} onChange={set("position")} /></div>
          <div><label className="field-label">PAN</label><input className="field" value={f.pan} onChange={set("pan")} /></div>
        </div>
        <div className="step-label" style={{ marginTop: 16 }}>Monthly earnings</div>
        <div className="form-grid">{num("basicSalary", "Basic salary")}{num("leaveBonus", "Leave bonus")}{num("overtime", "Overtime")}{num("otherAllowances", "Other allowances")}</div>
        <div className="step-label" style={{ marginTop: 16 }}>Monthly deductions</div>
        <div className="form-grid">{num("pf", "PF")}{num("tds", "TDS")}{num("otherDeductions", "Other deductions")}{num("retention", "Retention")}</div>
        <p className="lead" style={{ marginTop: 12 }}>Net payable: <strong>₹{(gross - ded).toLocaleString("en-IN")}</strong></p>
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.basicSalary || !userId || !companyId} onClick={() => {
            onSave({ userId, companyId, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, ["employeeCode", "position", "pan"].includes(k) ? v : Number(v || 0)])) });
            onClose();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
