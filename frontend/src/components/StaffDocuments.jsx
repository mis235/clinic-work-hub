import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const fmtSize = (n) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// A person's HR file: one slot per required paper (ID proof, certificates, bank details…). Admin uploads; the person can view their own.
export default function StaffDocuments({ staffId, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const input = useRef(null);
  const pending = useRef(null);

  const load = () => api.listStaffFiles(staffId).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [staffId]);

  function choose(type) { pending.current = type; input.current.value = ""; input.current.click(); }
  async function onFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const type = pending.current; setBusy(type); setErr("");
    try { const fd = new FormData(); fd.append("docType", type); fd.append("file", f); await api.addStaffFile(staffId, fd); await load(); onChanged?.(); }
    catch (x) { setErr(x.message); } finally { setBusy(""); }
  }
  async function remove(f) {
    if (!window.confirm(`Remove "${f.file_name}"?`)) return;
    try { await api.deleteDocument(f.id); await load(); onChanged?.(); } catch (x) { setErr(x.message); }
  }

  if (!data) return err ? <div className="login-error">{err}</div> : <div className="empty">Loading…</div>;
  const have = new Set(data.files.map((f) => f.doc_type));
  const done = data.types.filter((t) => have.has(t.key)).length;

  return (
    <div>
      <input ref={input} type="file" style={{ display: "none" }} onChange={onFile} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="progress lg"><span style={{ width: `${(done / data.types.length) * 100}%` }} /></div>
        </div>
        <strong style={{ fontSize: 13 }}>{done} of {data.types.length} documents on file</strong>
      </div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="grid-2">
        {data.types.map((t) => {
          const files = data.files.filter((f) => f.doc_type === t.key);
          return (
            <div key={t.key} className="card" style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div className={`kpi-ico ${files.length ? "green" : "amber"}`} style={{ width: 34, height: 34 }}><Icon name={files.length ? "check" : "file"} size={16} /></div>
                  <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.label}</div><div className="meta">{files.length ? "On file" : "Missing"}</div></div>
                </div>
                {data.canManage && <button className="btn btn-outline btn-sm" disabled={busy === t.key} onClick={() => choose(t.key)}>{busy === t.key ? "Uploading…" : files.length ? "Add another" : "Upload"}</button>}
              </div>
              {files.map((f) => (
                <div key={f.id} className="task-row" style={{ padding: "8px 0 0", border: 0 }}>
                  <span className="link" style={{ fontSize: 12.5 }} onClick={() => api.downloadDocument(f.id, f.file_name).catch((x) => setErr(x.message))}>{f.file_name} <span className="meta">{fmtSize(f.size)}</span></span>
                  {data.canManage && <button className="btn btn-ghost btn-sm" onClick={() => remove(f)}>Remove</button>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
