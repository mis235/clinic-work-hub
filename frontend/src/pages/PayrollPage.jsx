import { useEffect, useState } from "react";
import { api } from "../api.js";
import { navItemsFor } from "../navItems.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function PayrollPage({ user, onLogout, onBack }) {
  const [profiles, setProfiles] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [roster, setRoster] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);
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
      flash(`Payslip generated for ${period}. Add GMAIL_USER/GMAIL_APP_PASSWORD to .env to email it automatically.`);
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

        {profiles?.map((p) => (
          <div key={p.user_id} className="card">
            <div className="card-head">
              <div><span className="name">{p.name}</span><span className="dept">{p.employee_code || "no employee code"}</span></div>
              <span className="phone">{p.email || "no email on file — payslip can't be emailed yet"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8 }}>
              <span>Basic: ₹{p.basic_salary.toLocaleString("en-IN")} · Retention: ₹{p.retention.toLocaleString("en-IN")}</span>
              <button className="btn-wa btn-sm" onClick={() => generateFor(p.user_id)}>Generate this month's slip</button>
            </div>
          </div>
        ))}

        {toast && <div className="toast">{toast}</div>}
        {showForm && (
          <ProfileForm
            roster={roster.filter((r) => r.role !== "admin")}
            companies={companies}
            onClose={() => setShowForm(false)}
            onSave={async (p) => { await api.setPayProfile(p); refresh(); flash("Pay profile saved."); }}
          />
        )}
      </div>
    </div>
  );
}

function ProfileForm({ roster, companies, onClose, onSave }) {
  const [userId, setUserId] = useState(roster[0]?.id || "");
  const [companyId, setCompanyId] = useState(companies[0]?.id || "");
  const [employeeCode, setEmployeeCode] = useState("");
  const [position, setPosition] = useState("");
  const [basicSalary, setBasicSalary] = useState("");
  const [retention, setRetention] = useState("0");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Set up pay profile</h3>
        <label className="field-label">Employee</label>
        <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {roster.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.department}</option>)}
        </select>
        <label className="field-label">Company</label>
        <select className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="field-label">Employee code</label>
        <input className="field" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
        <label className="field-label">Position</label>
        <input className="field" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. MIS Executive" />
        <label className="field-label">Basic salary (monthly)</label>
        <input className="field" type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
        <label className="field-label">Retention deduction (if any)</label>
        <input className="field" type="number" value={retention} onChange={(e) => setRetention(e.target.value)} />
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!basicSalary} onClick={() => {
            onSave({ userId, companyId, employeeCode, position, basicSalary: Number(basicSalary), retention: Number(retention) });
            onClose();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
