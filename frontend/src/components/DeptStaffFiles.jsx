import { useEffect, useState } from "react";
import { api } from "../api.js";

// Departmental Workspaces → Staff files: each person in the department with their letters, ID proofs and other files, grouped by type.
export default function DeptStaffFiles({ deptId, onOpenProfile }) {
  const [data, setData] = useState(null), [open, setOpen] = useState({}), [err, setErr] = useState("");
  useEffect(() => { setData(null); api.listDeptStaffFiles(deptId).then(setData).catch((e) => setErr(e.message)); }, [deptId]);
  if (err) return <div className="login-error">{err}</div>;
  if (!data) return <div className="empty">Loading…</div>;
  const label = (k) => [...data.recordTypes, ...data.checklist].find((t) => t.key === k)?.label || "Other";
  const get = (r) => (r.offer ? api.downloadGenerated(r.id, r.file_name) : api.downloadDocument(r.id, r.file_name)).catch((x) => setErr(x.message));
  return (
    <div className="card">
      <div className="title" style={{ marginBottom: 6 }}>Staff files · {data.department.name}</div>
      {data.people.length === 0 && <div className="empty">No one in this department yet.</div>}
      {data.people.map((p) => {
        const all = [...p.offerLetters.map((o) => ({ ...o, type: "offer_letter", offer: true })), ...p.files.map((f) => ({ ...f, type: f.doc_type }))];
        const groups = {}; all.forEach((r) => { (groups[r.type || "other"] ||= []).push(r); });
        return (
          <div key={p.id} style={{ borderTop: "1px solid var(--line, #eee)", padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }} onClick={() => setOpen({ ...open, [p.id]: !open[p.id] })}>
              <div style={{ flex: 1 }}><div className="title">{p.name}{p.active ? "" : " (former)"}</div><div className="meta">{p.designation || "—"}</div></div>
              <span className="badge accepted">{all.length} file{all.length === 1 ? "" : "s"}</span>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(p.id); }}>Open file</button>
            </div>
            {open[p.id] && (all.length === 0 ? <div className="meta" style={{ marginTop: 6 }}>No files yet.</div> : Object.entries(groups).map(([t, rows]) => (
              <div key={t} style={{ marginTop: 8 }}>
                <div className="meta" style={{ fontWeight: 700 }}>{t === "offer_letter" ? "Offer letters" : label(t)} · {rows.length}</div>
                {rows.map((r) => <div key={r.id}><span className="link" style={{ fontSize: 12.5 }} onClick={() => get(r)}>{r.file_name}</span></div>)}
              </div>)))}
          </div>);
      })}
    </div>
  );
}
