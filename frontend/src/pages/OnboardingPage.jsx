import { useEffect, useMemo, useState, useCallback } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Icon, { initials } from "../components/Icon.jsx";
import StaffEditModal, { inputToMmdd } from "../components/StaffEditModal.jsx";

const FILTERS = [["all", "All staff"], ["not_started", "Not started"], ["in_progress", "In progress"], ["complete", "Complete"]];
const barClass = (pct) => (pct === 100 ? "green" : pct >= 50 ? "" : "amber");

export default function OnboardingPage({ user, onLogout, onBack, onOpenProfile }) {
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [shiftRoles, setShiftRoles] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);       // id of the card whose documents are expanded
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [toast, setToast] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = useCallback(() => {
    api.getOnboarding().then(setData).catch(() => setData({ docChecklist: [], people: [] }));
    api.listRosterFull().then(setRoster).catch(() => setRoster([]));
  }, []);
  useEffect(() => { refresh(); api.listShiftRoles().then(setShiftRoles).catch(() => {}); }, [refresh]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3200); };
  const people = data?.people || [];
  const counts = useMemo(() => ({
    all: people.length,
    not_started: people.filter((p) => p.status === "not_started").length,
    in_progress: people.filter((p) => p.status === "in_progress").length,
    complete: people.filter((p) => p.status === "complete").length,
  }), [people]);
  const avg = people.length ? Math.round(people.reduce((s, p) => s + p.pct, 0) / people.length) : 0;
  const shown = people.filter((p) => (filter === "all" || p.status === filter) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const managers = roster.filter((r) => r.role === "admin" || r.role === "manager").map((r) => r.name);
  const departments = [...new Set(roster.map((r) => r.department).filter(Boolean))];

  async function toggleDoc(p, key) {
    const next = !p.docs[key];
    setData((d) => ({ ...d, people: d.people.map((x) => (x.id === p.id ? { ...x, docs: { ...x.docs, [key]: next } } : x)) }));
    try { await api.setOnboardingDocs(p.id, { [key]: next }); refresh(); } catch (e) { flash(e.message); refresh(); }
  }

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Onboarding" onSelect={(i) => i !== "Onboarding" && onBack(i)}
        who={`${user.name} · Admin`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="Onboarding" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head row">
          <div>
            <div className="eyebrow">People</div>
            <h1>Staff Onboarding</h1>
            <p>One complete record for every team member — personal details, employment, emergency contact and the documents HR must collect. The score shows what is still missing.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setWizard(true)}><Icon name="userplus" size={17} /> Onboard new staff</button>
        </div>

        <div className="kpi-grid">
          <Kpi icon="users" tone="teal" value={counts.all} label="Active staff" />
          <Kpi icon="check" tone="green" value={counts.complete} label="Fully onboarded" hint="100% of record complete" />
          <Kpi icon="clock" tone="amber" value={counts.in_progress + counts.not_started} label="Records to complete" hint={`${counts.not_started} not started`} />
          <Kpi icon="chart" tone="blue" value={`${avg}%`} label="Average completeness" />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <div className="pill-row" style={{ margin: 0, flex: 1 }}>
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`pill ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{label}<span className="n">{counts[k]}</span></button>
            ))}
          </div>
          <input className="field" style={{ maxWidth: 230 }} placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {data === null && <div className="empty">Loading…</div>}
        {data && shown.length === 0 && <div className="empty">No staff match this filter.</div>}

        {shown.map((p) => {
          const full = roster.find((r) => r.id === p.id);
          const docsDone = (data.docChecklist || []).filter((d) => p.docs[d.key]).length;
          return (
            <div key={p.id} className="card">
              <div className="person-row">
                <div className="avatar lg" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(p.name)}</div>
                <div className="info">
                  <div className="nm"><span className="link" onClick={() => onOpenProfile(p.id)}>{p.name}</span> {p.mustChangePin && <span className="badge in_progress" style={{ marginLeft: 6 }}>PIN not changed</span>}</div>
                  <div className="sub">{p.designation || "No designation"} · {p.department || "No department"} · {p.employeeCode || "—"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, maxWidth: 420 }}>
                    <div className="progress" style={{ flex: 1 }}><span style={{ width: `${p.pct}%` }} className={barClass(p.pct)} /></div>
                    <strong style={{ fontSize: 13, minWidth: 38 }}>{p.pct}%</strong>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>Documents {docsDone}/{data.docChecklist.length}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => full && setEditing(full)}>Edit details</button>
                  <button className="btn btn-ghost btn-sm" title="Reset PIN" onClick={() => setResetting(p)}><Icon name="key" size={14} /></button>
                </div>
              </div>

              {p.missing.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <span className="meta" style={{ marginRight: 8 }}>Still needed:</span>
                  {p.missing.slice(0, 6).map((m) => <span key={m} className="chip warn">{m}</span>)}
                  {p.missing.length > 6 && <span className="chip">+{p.missing.length - 6} more</span>}
                </div>
              )}

              {open === p.id && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <div className="step-label">Documents collected</div>
                  <div className="doc-grid">
                    {data.docChecklist.map((d) => (
                      <button key={d.key} className={`doc ${p.docs[d.key] ? "on" : ""}`} onClick={() => toggleDoc(p, d.key)}>
                        <span className="box">{p.docs[d.key] && <Icon name="check" size={13} strokeWidth={3} />}</span>{d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {editing && (
          <StaffEditModal staff={editing} shiftRoles={shiftRoles} managers={managers} onClose={() => setEditing(null)}
            onSave={async (payload) => { try { await api.updateUser(editing.id, payload); flash(`Saved ${editing.name}.`); } catch (e) { flash(e.message); } refresh(); }} />
        )}
        {resetting && <ResetPinModal person={resetting} onClose={() => setResetting(null)} onDone={(m) => { flash(m); refresh(); }} />}
        {wizard && (
          <WizardModal shiftRoles={shiftRoles} managers={managers} departments={departments}
            onClose={() => { setWizard(false); refresh(); }} onOpenProfile={onOpenProfile} />
        )}
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  );
}

function Kpi({ icon, tone, value, label, hint }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><div className={`kpi-ico ${tone}`}><Icon name={icon} size={19} /></div></div>
      <div className="value">{value}</div>
      <div><div className="label">{label}</div>{hint && <div className="hint">{hint}</div>}</div>
    </div>
  );
}

function ResetPinModal({ person, onClose, onDone }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  async function go() {
    try { await api.resetStaffPin(person.id, pin); onDone(`PIN reset for ${person.name}. They must change it at next sign-in.`); onClose(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Reset PIN — {person.name}</h3>
        <p className="lead">Set a temporary 4-digit PIN and share it with them privately. They will be asked to choose their own at next sign-in.</p>
        <label className="field-label">Temporary PIN</label>
        <input className="field" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4 digits" />
        {err && <div className="login-error">{err}</div>}
        <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={pin.length !== 4} onClick={go}>Reset PIN</button></div>
      </div>
    </div>
  );
}

const STEPS = ["Personal details", "Employment", "Checklist role", "Emergency & access"];

function WizardModal({ shiftRoles, managers, departments, onClose, onOpenProfile }) {
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "", phone: "", email: "", birthday: "", gender: "", bloodGroup: "", address: "",
    departmentName: "", roleName: "staff", designation: "", employmentType: "Full-time", joinedAt: new Date().toISOString().slice(0, 10), reportingTo: "",
    shiftRole: "", emergencyContactName: "", emergencyContactPhone: "", pin: String(Math.floor(1000 + Math.random() * 9000)),
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const canNext = [
    f.name.trim() && f.phone.trim(),
    f.departmentName.trim() && f.roleName,
    true,
    /^\d{4}$/.test(f.pin),
  ][step];

  async function submit() {
    setBusy(true); setErr("");
    try {
      const res = await api.createStaff({ ...f, birthday: inputToMmdd(f.birthday) || undefined, email: f.email || undefined });
      setCreated(res);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (created) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="kpi-ico green" style={{ marginBottom: 12 }}><Icon name="check" size={20} /></div>
          <h3>{created.name} has been added</h3>
          <p className="lead">Their record is created. Share these sign-in details privately:</p>
          <div className="card flat" style={{ background: "var(--surface-sunk)", marginTop: 14 }}>
            <div className="kv"><span className="k">Sign in as</span><span className="v">{created.name}</span></div>
            <div className="kv"><span className="k">Temporary PIN</span><span className="v" style={{ fontSize: 18, letterSpacing: 4 }}>{f.pin}</span></div>
          </div>
          <div className="note" style={{ marginTop: 14 }}>They will be asked to set their own PIN the first time they sign in. Next, collect their documents from the Onboarding list.</div>
          <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Done</button><button className="btn btn-primary" onClick={() => { onClose(); onOpenProfile(created.id); }}>View profile</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="step-label">Step {step + 1} of {STEPS.length}</div>
        <h3>{STEPS[step]}</h3>
        <div className="stepper">{STEPS.map((_, i) => <div key={i} className={`step ${i < step ? "done" : i === step ? "current" : ""}`} />)}</div>

        {step === 0 && (
          <div className="form-grid">
            <div className="full"><label className="field-label">Full name *</label><input className="field" value={f.name} onChange={set("name")} autoFocus /></div>
            <div><label className="field-label">WhatsApp / mobile *</label><input className="field" value={f.phone} onChange={set("phone")} placeholder="+91XXXXXXXXXX" /></div>
            <div><label className="field-label">Email</label><input className="field" type="email" value={f.email} onChange={set("email")} /></div>
            <div><label className="field-label">Date of birth</label><input className="field" type="date" value={f.birthday} onChange={set("birthday")} /></div>
            <div><label className="field-label">Gender</label><select className="field" value={f.gender} onChange={set("gender")}>{["", "Female", "Male", "Other"].map((t) => <option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
            <div><label className="field-label">Blood group</label><select className="field" value={f.bloodGroup} onChange={set("bloodGroup")}>{["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((t) => <option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
            <div className="full"><label className="field-label">Home address</label><textarea className="field" style={{ minHeight: 56 }} value={f.address} onChange={set("address")} /></div>
          </div>
        )}
        {step === 1 && (
          <div className="form-grid">
            <div><label className="field-label">Department *</label>
              <input className="field" list="dept-list" value={f.departmentName} onChange={set("departmentName")} placeholder="Choose or type a new one" />
              <datalist id="dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist></div>
            <div><label className="field-label">Access level *</label>
              <select className="field" value={f.roleName} onChange={set("roleName")}><option value="staff">Staff</option><option value="manager">Manager</option></select></div>
            <div><label className="field-label">Designation / job title</label><input className="field" value={f.designation} onChange={set("designation")} /></div>
            <div><label className="field-label">Employment type</label><select className="field" value={f.employmentType} onChange={set("employmentType")}>{["Full-time", "Part-time", "Contract", "Intern"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="field-label">Date of joining</label><input className="field" type="date" value={f.joinedAt} onChange={set("joinedAt")} /></div>
            <div><label className="field-label">Reports to</label><select className="field" value={f.reportingTo} onChange={set("reportingTo")}><option value="">— Select —</option>{managers.map((m) => <option key={m}>{m}</option>)}</select></div>
          </div>
        )}
        {step === 2 && (
          <div>
            <p className="lead">Pick the daily Opening / During-the-day / End-of-day checklist this person will fill in. Leave empty if their role has no shift checklist.</p>
            <label className="field-label">Shift checklist role</label>
            <select className="field" value={f.shiftRole} onChange={set("shiftRole")}><option value="">— None —</option>{shiftRoles.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </div>
        )}
        {step === 3 && (
          <div className="form-grid">
            <div><label className="field-label">Emergency contact name & relation</label><input className="field" value={f.emergencyContactName} onChange={set("emergencyContactName")} /></div>
            <div><label className="field-label">Emergency contact phone</label><input className="field" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></div>
            <div className="full"><label className="field-label">Temporary sign-in PIN (4 digits)</label>
              <input className="field" inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF((x) => ({ ...x, pin: e.target.value.replace(/\D/g, "") }))} />
              <div className="login-hint">Suggested at random. The person must change it at first sign-in.</div></div>
          </div>
        )}

        {err && <div className="login-error">{err}</div>}
        <div className="actions">
          {step === 0 ? <button className="btn btn-ghost" onClick={onClose}>Cancel</button> : <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1
            ? <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</button>
            : <button className="btn btn-primary" disabled={!canNext || busy} onClick={submit}>{busy ? "Creating…" : "Create staff member"}</button>}
        </div>
      </div>
    </div>
  );
}
