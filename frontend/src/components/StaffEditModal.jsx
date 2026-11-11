import { useState } from "react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";

// MM-DD (as stored) <-> a date-input value. Year is irrelevant for birthdays.
export const mmddToInput = (v) => (v && /^\d{2}-\d{2}$/.test(v) ? `2000-${v}` : "");
export const inputToMmdd = (v) => (v ? v.slice(5) : null);

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const TYPES = ["", "Full-time", "Part-time", "Contract", "Intern"];

export default function StaffEditModal({ staff, shiftRoles, managers = [], departments = [], onClose, onSave, onPhoto, showAccess = false }) {
  const [isHr, setIsHr] = useState(!!staff.is_hr); const [leadership, setLeadership] = useState(!!staff.leadership);
  const [pv, setPv] = useState(0);
  const [hasPhoto, setHasPhoto] = useState(!!staff.has_photo);
  const [pErr, setPErr] = useState("");
  const canAdmin = false; // only the one admin account is admin
  async function pickPhoto(file) {
    if (!file) return;
    try { await api.uploadPhoto(staff.id, file); setHasPhoto(true); setPv(Date.now()); setPErr(""); onPhoto?.(); } catch (e) { setPErr(e.message); }
  }
  async function dropPhoto() { try { await api.removePhoto(staff.id); setHasPhoto(false); onPhoto?.(); } catch (e) { setPErr(e.message); } }
  const [f, setF] = useState({
    name: staff.name || "", departmentName: staff.department || "", roleName: staff.role || "staff",
    designation: staff.designation || "", employeeCode: staff.employee_code || "", employmentType: staff.employment_type || "",
    reportingTo: staff.reporting_to || "", joinedAt: staff.joined_at || "", shiftRole: staff.shift_role || "",
    shiftStart: staff.shift_start || "", shiftEnd: staff.shift_end || "", lateFineType: staff.late_fine_type || "default", lateFineValue: staff.late_fine_value ?? "",
    phone: staff.phone || "", altPhone: staff.alt_phone || "", email: staff.email || "", birthday: mmddToInput(staff.birthday), gender: staff.gender || "",
    bloodGroup: staff.blood_group || "", address: staff.address || "",
    emergencyContactName: staff.emergency_contact_name || "", emergencyContactPhone: staff.emergency_contact_phone || "",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  function save() {
    onSave({
      name: f.name.trim() || undefined, departmentName: f.departmentName || undefined, roleName: f.roleName || undefined,
      designation: f.designation || null, employeeCode: f.employeeCode || null, employmentType: f.employmentType || null,
      reportingTo: f.reportingTo || null, joinedAt: f.joinedAt || null, shiftRole: f.shiftRole,
      shiftStart: f.shiftStart || null, shiftEnd: f.shiftEnd || null, lateFineType: f.lateFineType || "default", lateFineValue: f.lateFineType === "default" ? null : Number(f.lateFineValue) || null,
      phone: f.phone || null, altPhone: f.altPhone || null, email: f.email || null, birthday: inputToMmdd(f.birthday), gender: f.gender || null,
      bloodGroup: f.bloodGroup || null, address: f.address || null,
      emergencyContactName: f.emergencyContactName || null, emergencyContactPhone: f.emergencyContactPhone || null,
      ...(showAccess ? { isHr, leadership } : {}),
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Edit {staff.name}</h3>
        <p className="lead">{staff.department} · {staff.role}</p>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
          <Avatar id={staff.id} name={staff.name} hasPhoto={hasPhoto} size={64} v={pv} />
          <div>
            <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>{hasPhoto ? "Change picture" : "Add picture"}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickPhoto(e.target.files[0])} /></label>
            {hasPhoto && <button className="btn btn-ghost btn-sm" onClick={dropPhoto}>Remove</button>}
            {pErr && <div className="login-error" style={{ marginTop: 6 }}>{pErr}</div>}
          </div>
        </div>
        <div className="step-label" style={{ marginTop: 14 }}>Basics</div>
        <div className="form-grid">
          <div><label className="field-label">Full Name</label><input className="field" value={f.name} onChange={set("name")} /></div>
          <div><label className="field-label">Department</label>
            <select className="field" value={f.departmentName} onChange={set("departmentName")}>
              {[...new Set([f.departmentName, ...departments].filter(Boolean))].map((d) => <option key={d}>{d}</option>)}</select></div>
          <div><label className="field-label">Access Level</label>
            <select className="field" value={f.roleName} onChange={set("roleName")}>
              <option value="staff">Staff</option><option value="manager">Manager (sees all, assigns tasks)</option>{(canAdmin || staff.role === "admin") && <option value="admin">Admin (full control)</option>}</select></div>
        </div>

        {showAccess && (
          <div className="note" style={{ marginTop: 14 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}><input type="checkbox" checked={isHr} onChange={(e) => setIsHr(e.target.checked)} style={{ marginTop: 3 }} /><span><b>HR — leave approver</b><br /><span className="meta">Receives leave requests, confirms them, records Sir/Mam's approval, sees late arrivals and birthdays, sets the HR rules.</span></span></label>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={leadership} onChange={(e) => setLeadership(e.target.checked)} style={{ marginTop: 3 }} /><span><b>Leadership access (MIS, COS, COE, doctors)</b><br /><span className="meta">Sees Reports, Dashboards, Knowledge and the full-clinic assistant. Everyone else only sees their own work.</span></span></label>
          </div>
        )}

        <div className="step-label" style={{ marginTop: 20 }}>Employment</div>
        <div className="form-grid">
          <div><label className="field-label">Designation / Job Title</label><input className="field" value={f.designation} onChange={set("designation")} placeholder="e.g. Front Desk Executive" /></div>
          <div><label className="field-label">Employee Code</label><input className="field" value={f.employeeCode} onChange={set("employeeCode")} /></div>
          <div><label className="field-label">Employment Type</label>
            <select className="field" value={f.employmentType} onChange={set("employmentType")}>{TYPES.map((t) => <option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
          <div><label className="field-label">Reports to</label>
            <select className="field" value={f.reportingTo} onChange={set("reportingTo")}>
              <option value="">— Select —</option>{managers.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          <div><label className="field-label">Date of Joining</label><input className="field" type="date" value={f.joinedAt} onChange={set("joinedAt")} /></div>
          <div><label className="field-label">Shift Checklist Role</label>
            <select className="field" value={f.shiftRole} onChange={set("shiftRole")}>
              <option value="">— None —</option>{shiftRoles.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>

        <div className="step-label" style={{ marginTop: 20 }}>Shift Timing & Late Fine</div>
        <div className="form-grid">
          <div style={{ gridColumn: "1 / -1" }}><label className="field-label">Quick Pick</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["09:00", "18:30"], ["09:30", "19:00"], ["10:00", "19:30"]].map(([a, b]) => (
                <button key={a} type="button" className={"chip" + (f.shiftStart === a && f.shiftEnd === b ? " active" : "")} style={{ minHeight: 40 }}
                  onClick={() => setF((x) => ({ ...x, shiftStart: a, shiftEnd: b }))}>{a} – {b}</button>))}
            </div></div>
          <div><label className="field-label">Shift Starts</label><input className="field" type="time" value={f.shiftStart} onChange={set("shiftStart")} /></div>
          <div><label className="field-label">Shift Ends</label><input className="field" type="time" value={f.shiftEnd} onChange={set("shiftEnd")} /></div>
          <div><label className="field-label">Fine for every 3 lates</label>
            <select className="field" value={f.lateFineType} onChange={set("lateFineType")}>
              <option value="default">Clinic default amount</option><option value="flat">Fixed ₹ amount</option><option value="day_pct">% of one day's salary</option></select></div>
          {f.lateFineType !== "default" && <div><label className="field-label">{f.lateFineType === "flat" ? "Amount (₹)" : "Percent of one day's salary"}</label>
            <input className="field" type="number" inputMode="decimal" value={f.lateFineValue} onChange={set("lateFineValue")} /></div>}
          <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--muted)" }}>Late = more than 15 minutes after the shift start. Every 3 late days = 1 fine, added to payroll automatically.</div>
        </div>

        <div className="step-label" style={{ marginTop: 20 }}>Personal & Contact</div>
        <div className="form-grid">
          <div><label className="field-label">WhatsApp / Mobile</label><input className="field" value={f.phone} onChange={set("phone")} placeholder="+91XXXXXXXXXX" /></div>
          <div><label className="field-label">Alternate Number</label><input className="field" value={f.altPhone} onChange={set("altPhone")} /></div>
          <div><label className="field-label">Email</label><input className="field" type="email" value={f.email} onChange={set("email")} /></div>
          <div><label className="field-label">Date of birth (day & month used)</label><input className="field" type="date" value={f.birthday} onChange={set("birthday")} /></div>
          <div><label className="field-label">Gender</label>
            <select className="field" value={f.gender} onChange={set("gender")}>{["", "Female", "Male", "Other"].map((t) => <option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
          <div><label className="field-label">Blood Group</label>
            <select className="field" value={f.bloodGroup} onChange={set("bloodGroup")}>{BLOOD.map((t) => <option key={t} value={t}>{t || "— Select —"}</option>)}</select></div>
          <div className="full"><label className="field-label">Home Address</label><textarea className="field" style={{ minHeight: 56 }} value={f.address} onChange={set("address")} /></div>
        </div>

        <div className="step-label" style={{ marginTop: 20 }}>Emergency Contact</div>
        <div className="form-grid">
          <div><label className="field-label">Contact Name & Relation</label><input className="field" value={f.emergencyContactName} onChange={set("emergencyContactName")} placeholder="e.g. Ramesh (Father)" /></div>
          <div><label className="field-label">Contact Phone</label><input className="field" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></div>
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save changes</button>
        </div>
      </div>
    </div>
  );
}
