import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import TemplateStudio from "../components/TemplateStudio.jsx";

export default function OfferLettersPage({ user, onLogout, onBack }) {
  const [letters, setLetters] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [preview, setPreview] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [roster, setRoster] = useState([]);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 4500); };

  const refresh = () => api.listOfferLetters().then(setLetters).catch(() => setLetters([]));
  useEffect(() => { refresh(); api.listCompanies().then(setCompanies).catch(() => {}); api.listRosterFull().then(setRoster).catch(() => {}); }, []);

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="HR"
        onSelect={(item) => item !== "HR" && onBack(item)}
        who={`${user.name} · Admin`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="HR — Offer Letters" onOpenMenu={() => setMobileOpen(true)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="page-head"><h1>Offer Letters</h1><p>Upload your own offer-letter template once, then generate every staff member's letter in one click. For a single new hire without a template, use the quick form.</p></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(true)}>Quick letter (no template)</button>
        </div>
        <TemplateStudio kind="offer_letter" companies={companies} roster={roster} flash={flash} />
        {toast && <div className="toast">{toast}</div>}
        <div className="section-head" style={{ marginTop: 24 }}><h2 style={{ fontSize: 15 }}>Quick letters</h2></div>

        {letters === null && <div className="empty">Loading…</div>}
        {letters?.length === 0 && <div className="empty">No offer letters generated yet.</div>}
        {letters?.map((l) => (
          <div key={l.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{l.candidate_name}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{l.role_title}{l.department ? ` · ${l.department}` : ""}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setPreview(l)}>View</button>
            </div>
          </div>
        ))}

        {showForm && (
          <OfferForm
            onClose={() => setShowForm(false)}
            onCreate={async (p) => { const r = await api.createOfferLetter(p); refresh(); setPreview({ ...p, body_text: r.bodyText, candidate_name: p.candidateName }); }}
          />
        )}
        {preview && (
          <div className="modal-backdrop" onClick={() => setPreview(null)}>
            <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
              <h3>{preview.candidate_name}</h3>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.6, maxHeight: 420, overflowY: "auto" }}>{preview.body_text}</pre>
              <div className="actions"><button className="btn btn-primary" onClick={() => setPreview(null)}>Close</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OfferForm({ onClose, onCreate }) {
  const [candidateName, setCandidateName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [salaryText, setSalaryText] = useState("");
  const [startDate, setStartDate] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New offer letter</h3>
        <label className="field-label">Candidate name</label>
        <input className="field" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} />
        <label className="field-label">Role</label>
        <input className="field" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
        <label className="field-label">Department</label>
        <input className="field" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <label className="field-label">Salary (free text)</label>
        <input className="field" value={salaryText} onChange={(e) => setSalaryText(e.target.value)} placeholder="e.g. ₹25,000/month" />
        <label className="field-label">Start date</label>
        <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!candidateName.trim() || !roleTitle.trim()} onClick={() => { onCreate({ candidateName, roleTitle, department, salaryText, startDate }); onClose(); }}>Generate</button>
        </div>
      </div>
    </div>
  );
}
