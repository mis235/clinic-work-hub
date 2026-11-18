import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
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

  const [slips, setSlips] = useState(null), [slipEdit, setSlipEdit] = useState(null), [tab, setTab] = useState("draft");
  const inCo = (slips || []).filter((x) => company === "all" || x.company_id === company);
  const shown = inCo.filter((x) => tab === "all" || (tab === "draft" ? !x.published_at : !!x.published_at));
  const monthName = (p) => new Date(p + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const loadSlips = () => api.listPayslips().then(setSlips).catch(() => setSlips([]));
  useEffect(() => { loadSlips(); }, []);
  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3500); }

  async function generateFor(userId) {
    const period = new Date().toISOString().slice(0, 7), who = profiles?.find((p) => p.user_id === userId)?.name || "staff";
    try {
      await api.generatePayroll({ period, userId, sendEmail: false });
      loadSlips();
      flash(`Payslip for ${who} is ready as a draft. Check it under "Generated payslips" below (View PDF), then press Send to staff.`);
    } catch (e) { flash(e.message); }
  }
  async function sendSlip(s) {
    try {
      const r = await api.sendPayslip(s.id); loadSlips();
      flash(r.emailed ? `Sent. In ${s.user_name}'s login and emailed to ${r.to}, copy to accounts and COO.` : r.warning);
    } catch (e) { flash(e.message); }
  }
  async function sendAllDrafts() {
    const drafts = (slips || []).filter((s) => !s.published_at);
    if (!drafts.length) return flash("No drafts waiting.");
    if (!confirm(`Send ${drafts.length} draft payslip(s) to staff now?`)) return;
    let ok = 0; for (const s of drafts) { try { await api.sendPayslip(s.id); ok++; } catch { /* keep going */ } }
    loadSlips(); flash(`Sent ${ok} of ${drafts.length} payslip(s).`);
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

        <div className="pay-stats">
          <div className="pay-stat"><span className="pay-stat-ico"><Icon name="users" size={18} /></span><div><b>{(profiles || []).filter((p) => company === "all" || p.company_id === company).length}</b><span>Staff with pay set up</span></div></div>
          <div className="pay-stat warn"><span className="pay-stat-ico"><Icon name="pencil" size={18} /></span><div><b>{inCo.filter((x) => !x.published_at).length}</b><span>Drafts waiting to be sent</span></div></div>
          <div className="pay-stat ok"><span className="pay-stat-ico"><Icon name="send" size={18} /></span><div><b>{inCo.filter((x) => x.published_at).length}</b><span>Sent to staff</span></div></div>
        </div>

        <div className="pill-row">
          <button className={`pill ${company === "all" ? "active" : ""}`} onClick={() => setCompany("all")}>All companies</button>
          {companies.map((c) => <button key={c.id} className={`pill ${company === c.id ? "active" : ""}`} onClick={() => setCompany(c.id)}>{c.name} <span className="n">{(profiles || []).filter((p) => p.company_id === c.id).length}</span></button>)}
        </div>

        <div className="card pay-panel">
          <div className="pay-panel-head">
            <div><h2>Payslips</h2><p>Check each payslip, then send it. Staff see it in their login only after you send.</p></div>
            <button className="btn btn-primary btn-sm" onClick={sendAllDrafts}><Icon name="send" size={15} /> Send all drafts</button>
          </div>
          <div className="seg">{[["draft", "Drafts", inCo.filter((x) => !x.published_at).length], ["sent", "Sent", inCo.filter((x) => x.published_at).length], ["all", "All", inCo.length]].map(([k, l, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l} <span>{n}</span></button>)}</div>
          {slips === null && <div className="empty">Loading…</div>}
          {slips && shown.length === 0 && <div className="empty">{tab === "draft" ? "No drafts waiting. Press Prepare payslip on a staff member below." : "Nothing here yet."}</div>}
          {shown.length > 0 && (
            <div className="pay-table-wrap"><table className="pay-table">
              <thead><tr><th>Employee</th><th>Month</th><th className="r">Net pay</th><th>Status</th><th className="r">Actions</th></tr></thead>
              <tbody>{shown.map((x) => (
                <tr key={x.id}>
                  <td><div className="pt-name">{x.user_name}</div><div className="pt-sub">{x.company_name}</div></td>
                  <td>{monthName(x.pay_period)}</td>
                  <td className="r pt-net">₹{Number(x.net_payable || 0).toLocaleString("en-IN")}</td>
                  <td>{x.published_at ? <span className="st st-sent">Sent</span> : <span className="st st-draft">Draft</span>}{x.published_at && <div className="pt-sub">{x.emailed_at ? "In login and emailed" : "In login, not emailed"}</div>}</td>
                  <td className="r"><div className="pt-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => api.openPayslip(x.id).catch((e) => flash(e.message))}><Icon name="eye" size={14} /> View</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSlipEdit(x)}><Icon name="pencil" size={14} /> Edit</button>
                    <button className={x.published_at ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"} onClick={() => sendSlip(x)}><Icon name="send" size={14} /> {x.published_at ? "Send again" : "Send"}</button>
                  </div></td>
                </tr>))}</tbody>
            </table></div>)}
        </div>

        <div className="card pay-panel">
          <div className="pay-panel-head"><div><h2>Salary set-up</h2><p>Each person's monthly pay. Prepare makes this month's draft payslip.</p></div></div>
          {profiles?.length === 0 && <div className="empty">No salary details yet. Press "+ Set up an employee's pay" above.</div>}
          <div className="pay-table-wrap"><table className="pay-table">
            <thead><tr><th>Employee</th><th>Company</th><th className="r">Basic</th><th className="r">Retention</th><th className="r">Actions</th></tr></thead>
            <tbody>{(profiles || []).filter((p) => company === "all" || p.company_id === company).map((p) => (
              <tr key={p.user_id}>
                <td><div className="pt-name">{p.name}</div><div className="pt-sub">{p.employee_code || "No employee code"}{p.email ? "" : " · no email on file"}</div></td>
                <td>{companies.find((c) => c.id === p.company_id)?.name || "-"}</td>
                <td className="r">₹{Number(p.basic_salary || 0).toLocaleString("en-IN")}</td>
                <td className="r">₹{Number(p.retention || 0).toLocaleString("en-IN")}</td>
                <td className="r"><div className="pt-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}><Icon name="pencil" size={14} /> Edit</button>
                  <button className="btn btn-primary btn-sm" onClick={() => generateFor(p.user_id)}>Prepare payslip</button>
                </div></td>
              </tr>))}</tbody>
          </table></div>
        </div>

        <TemplateStudio kind="payslip" companies={companies} roster={roster} flash={flash} />

        {slipEdit && <SlipEditor slip={slipEdit} onClose={() => setSlipEdit(null)} onSaved={() => { setSlipEdit(null); loadSlips(); flash("Payslip saved and PDF rebuilt. Check it with View PDF, then press Send to staff."); }} />}

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
  useEffect(() => { if (!userId && roster[0]) setUserId(roster[0].id); }, [roster]);
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies]);
  const [f, setF] = useState({
    employeeCode: i.employee_code || "", position: i.position || "", pan: i.pan || "",
    basicSalary: i.basic_salary ?? "", leaveBonus: i.leave_bonus ?? 0, overtime: i.overtime ?? 0, otherAllowances: i.other_allowances ?? 0, incentive: i.incentive ?? 0, arrears: i.arrears ?? 0,
    pf: i.pf ?? 0, tds: i.tds ?? 0, otherDeductions: i.other_deductions ?? 0, retention: i.retention ?? 0,
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (k, label) => (<div><label className="field-label">{label}</label><input className="field" type="number" value={f[k]} onChange={set(k)} /></div>);
  const gross = ["basicSalary", "leaveBonus", "overtime", "otherAllowances", "incentive", "arrears"].reduce((a, k) => a + Number(f[k] || 0), 0);
  const ded = ["pf", "tds", "otherDeductions", "retention"].reduce((a, k) => a + Number(f[k] || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? `Salary details — ${i.name}` : "Set up salary details"}</h3>
        <div className="form-grid">
          {!initial && <div><label className="field-label">Employee</label>
            <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>{roster.length === 0 && <option value="">Loading staff…</option>}{roster.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.department}</option>)}</select></div>}
          <div><label className="field-label">Company (who pays this person)</label>
            <select className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>{companies.length === 0 && <option value="">Loading…</option>}{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="field-label">Employee Code</label><input className="field" value={f.employeeCode} onChange={set("employeeCode")} /></div>
          <div><label className="field-label">Position on Payslip</label><input className="field" value={f.position} onChange={set("position")} /></div>
          <div><label className="field-label">PAN</label><input className="field" value={f.pan} onChange={set("pan")} /></div>
        </div>
        <div className="step-label" style={{ marginTop: 16 }}>Monthly Earnings</div>
        <div className="form-grid">{num("basicSalary", "Basic salary")}{num("leaveBonus", "Leave bonus")}{num("overtime", "Overtime")}{num("otherAllowances", "Other allowances")}{num("incentive", "Incentive")}{num("arrears", "Arrears")}</div>
        <div className="step-label" style={{ marginTop: 16 }}>Monthly Deductions</div>
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

function SlipEditor({ slip, onClose, onSaved }) {
  const pharm = /shanta|pharmacy/i.test(slip.company_name || "");
  let info = {}; try { info = JSON.parse(slip.info_json || "{}"); } catch { /* ignore */ }
  const lop = Number(slip.lop_amount || 0);
  const [f, setF] = useState({
    basic_salary: slip.basic_salary || 0, leave_bonus: slip.leave_bonus || 0, overtime: slip.overtime || 0,
    ...(pharm ? { other_allowances: slip.other_allowances || 0 } : { incentive: slip.incentive || 0, arrears: slip.arrears || 0 }),
    pf: slip.pf || 0, tds: slip.tds || 0, other_deductions: Math.max(0, (slip.other_deductions || 0) - lop), lop_amount: lop, retention: slip.retention || 0,
  });
  const [d, setD] = useState({ position: info.position || "", pan: info.pan || "", employeeCode: info.employeeCode || "", payDate: info.payDate || "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const L = { basic_salary: "Basic Salary", leave_bonus: "Leave Bonus", overtime: "Over Time", other_allowances: "Other Allowances", incentive: "Incentive", arrears: "Arrears", pf: "PF", tds: "TDS", other_deductions: "Other deductions", lop_amount: "Loss of pay", retention: "Retention" };
  const earn = Object.keys(f).filter((k) => !["pf", "tds", "other_deductions", "lop_amount", "retention"].includes(k));
  const net = earn.reduce((a, k) => a + Number(f[k] || 0), 0) - ["pf", "tds", "other_deductions", "lop_amount", "retention"].reduce((a, k) => a + Number(f[k] || 0), 0);
  async function save() {
    setBusy(true); setErr("");
    try { const info = {}; for (const [k, v] of Object.entries(d)) if (v) info[k] = v; await api.editPayslip(slip.id, { ...f, info }); onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  }
  const box = (k) => (<div key={k}><label className="field-label">{L[k]}</label><input className="field" type="number" min="0" value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></div>);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Edit payslip — {slip.user_name} — {slip.pay_period}</h3>
        <div className="form-grid">
          {[["position", "Position"], ["pan", "PAN"], ["employeeCode", "Employee ID"], ["payDate", "Pay Date (DD.MM.YYYY)"]].map(([k, l]) => <div key={k}><label className="field-label">{l}</label><input className="field" value={d[k]} placeholder="leave blank to keep" onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} /></div>)}
        </div>
        <label className="field-label" style={{ marginTop: 10 }}>Earnings</label>
        <div className="form-grid">{earn.map(box)}</div>
        <label className="field-label" style={{ marginTop: 10 }}>Deductions</label>
        <div className="form-grid">{["pf", "tds", "other_deductions", "lop_amount", "retention"].map(box)}</div>
        <p><b>Net Payable: ₹{net.toLocaleString("en-IN")}</b></p>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save and rebuild PDF</button></div>
      </div>
    </div>
  );
}
