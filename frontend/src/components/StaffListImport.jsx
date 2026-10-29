import { useState } from "react";
import { api } from "../api.js";

const DEPTS = ["Management", "Front Desk", "Therapist", "MDO", "Doctors", "Pharmacy", "Floor Coordinator", "Finance", "Supporting Staff"];

// Paste "Name - Designation" lines → check who matches an existing person → apply. Nothing is saved until you press Apply.
export default function StaffListImport({ onClose, onDone }) {
  const [text, setText] = useState("");
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true); setErr("");
    try { const r = await api.previewStaffList(text); setData(r); setRows(r.rows); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function apply() {
    setBusy(true); setErr("");
    try { const r = await api.applyStaffList(rows); onDone(`${r.added} added, ${r.updated} updated.`); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const nNew = rows.filter((r) => !r.matchId).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820, width: "96vw", maxHeight: "92vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3>Paste staff list</h3>
        {!data ? (
          <>
            <p className="lead">One person per line: <b>Name - Designation</b>. People already in the app are updated (name, designation, department); new people are added with PIN 1234 and must change it on first login.</p>
            <textarea className="field" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Zoya - Therapist\nDr.Arshiya\nAboli - HR"} />
            {err && <div className="login-error" style={{ marginTop: 8 }}>{err}</div>}
            <div className="actions"><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={preview}>{busy ? "Checking…" : "Check the list"}</button></div>
          </>
        ) : (
          <>
            <p className="lead">{rows.length} people. <b>{nNew}</b> will be added as new; the rest update an existing person. Change a match or department if something looks wrong.</p>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", fontSize: 13 }}>
                <thead><tr><th>Name</th><th>Designation</th><th>Department</th><th>Same as existing person</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input className="field" value={r.name} onChange={(e) => set(i, "name", e.target.value)} style={{ minWidth: 120 }} /></td>
                      <td><input className="field" value={r.designation} onChange={(e) => set(i, "designation", e.target.value)} style={{ minWidth: 130 }} /></td>
                      <td><select className="field" value={r.department} onChange={(e) => set(i, "department", e.target.value)}>{[...new Set([...DEPTS, r.department])].map((d) => <option key={d}>{d}</option>)}</select></td>
                      <td><select className="field" value={r.matchId || ""} onChange={(e) => { const u = data.staff.find((x) => x.id === e.target.value); setRows(rows.map((q, j) => (j === i ? { ...q, matchId: u?.id || null, matchName: u?.name || null } : q))); }}>
                        <option value="">➕ Add as new person</option>
                        {data.staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>People not in your list are not touched. Phone numbers for new people are placeholders — fix them in Edit details.</div>
            {err && <div className="login-error" style={{ marginTop: 8 }}>{err}</div>}
            <div className="actions"><button className="btn btn-outline" onClick={() => setData(null)}>Back</button><button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? "Saving…" : `Apply (${rows.length})`}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
