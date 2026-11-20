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
                <div key={f.id} className="task-row" style={{ padding: "8px 0 0", border: 0, flexWrap: "wrap" }}>
                  <span className="link" style={{ fontSize: 12.5 }} onClick={() => api.downloadDocument(f.id, f.file_name).catch((x) => setErr(x.message))}>{f.file_name} <span className="meta">{fmtSize(f.size)}</span></span>
                  {data.canManage && <RowEditor row={f} data={data} staffId={staffId} reload={() => load().then(() => onChanged?.())} setErr={setErr} />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <LettersAndRecords data={data} staffId={staffId} setErr={setErr} onRemove={remove} reload={() => load().then(() => onChanged?.())} />
    </div>
  );
}

// Offer, increment, experience, relieving ... letters and other records, one block per type. A person sees their own; complaints are admin-only.
function LettersAndRecords({ data, staffId, setErr, onRemove, reload }) {
  const [addType, setAddType] = useState(""), [busyAdd, setBusyAdd] = useState(false), addRef = useRef(null);
  async function addFile(f) {
    if (!f || !addType) return; setBusyAdd(true); setErr("");
    try { const fd = new FormData(); fd.append("docType", addType); fd.append("file", f); await api.addStaffFile(staffId, fd); setAddType(""); await reload(); } catch (x) { setErr(x.message); }
    setBusyAdd(false);
  }
  const offers = data.offerLetters || [], types = data.recordTypes || [];
  const blocks = [
    { key: "offer_letter", label: "Offer letters", rows: offers.map((o) => ({ id: o.id, file_name: o.file_name, size: 0, offer: true })) },
    ...types.map((t) => ({ key: t.key, label: t.label, rows: data.files.filter((f) => f.doc_type === t.key) })),
  ].filter((b) => b.rows.length);
  const get = (r) => (r.offer ? (data.canManage ? api.downloadGenerated(r.id, r.file_name) : api.downloadMyOfferLetter(r.id, r.file_name)) : api.downloadDocument(r.id, r.file_name)).catch((x) => setErr(x.message));
  return (
    <div style={{ marginTop: 22 }}>
      <div className="section-head"><h2 style={{ fontSize: 15 }}>Letters &amp; records</h2>
        {data.canManage && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input ref={addRef} type="file" hidden onChange={(e) => { addFile(e.target.files[0]); e.target.value = ""; }} />
          <select className="field" style={{ maxWidth: 220 }} value={addType} onChange={(e) => setAddType(e.target.value)}><option value="">Add a letter or record…</option>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <button className="btn btn-outline btn-sm" disabled={!addType || busyAdd} onClick={() => addRef.current.click()}>{busyAdd ? "Uploading…" : "Choose file"}</button>
        </div>}
      </div>
      {blocks.length === 0 && <div className="meta">No letters on file yet.</div>}
      <div className="grid-2">
        {blocks.map((b) => (
          <div key={b.key} className="card" style={{ marginBottom: 0, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{b.label} <span className="meta">· {b.rows.length}</span></div>
            {b.rows.map((r) => (
              <div key={r.id} className="task-row" style={{ padding: "6px 0 0", border: 0, flexWrap: "wrap" }}>
                <span className="link" style={{ fontSize: 12.5 }} onClick={() => get(r)}>{r.file_name} <span className="meta">{fmtSize(r.size)}</span></span>
                {data.canManage && <RowEditor row={{ ...r, doc_type: r.doc_type }} offer={!!r.offer} data={data} staffId={staffId} reload={reload} setErr={setErr} />}
              </div>))}
          </div>))}
      </div>
    </div>
  );
}

// Admin only: rename, re-type, move to another person, replace the file, or remove a document.
function RowEditor({ row, offer, data, staffId, reload, setErr }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(row.file_name), [type, setType] = useState(row.doc_type || ""), [uid, setUid] = useState(""), [people, setPeople] = useState([]), [busy, setBusy] = useState(false), ref = useRef(null);
  const kinds = [...data.types, ...(data.recordTypes || [])];
  useEffect(() => { if (open && !people.length) api.listRosterAll().then((l) => setPeople((l || []).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}); }, [open]);
  async function save() {
    setBusy(true); setErr("");
    try {
      if (offer) await api.updateGenerated(row.id, { fileName: name, userId: uid || undefined });
      else await api.updateDocument(row.id, { fileName: name, docType: type || undefined, userId: uid || undefined });
      setOpen(false); await reload();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function replace(f) {
    if (!f) return; setBusy(true); setErr("");
    try { const fd = new FormData(); fd.append("file", f); if (offer) await api.replaceGenerated(row.id, fd); else await api.replaceDocument(row.id, fd); await reload(); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function remove() {
    if (!window.confirm(`Delete "${row.file_name}"? This cannot be undone.`)) return;
    try { if (offer) await api.deleteGenerated(row.id); else await api.deleteDocument(row.id); await reload(); } catch (x) { setErr(x.message); }
  }
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</button>
        <button className="btn btn-ghost btn-sm" onClick={remove}>Delete</button>
      </div>
      {open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <input ref={ref} type="file" hidden onChange={(e) => { replace(e.target.files[0]); e.target.value = ""; }} />
          <input className="field" style={{ flex: "1 1 200px" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="File name" />
          {!offer && <select className="field" style={{ maxWidth: 220 }} value={type} onChange={(e) => setType(e.target.value)}>{kinds.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>}
          <select className="field" style={{ maxWidth: 220 }} value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Same person</option>{people.filter((p) => p.id !== staffId).map((p) => <option key={p.id} value={p.id}>Move to {p.name}</option>)}</select>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => ref.current.click()}>Replace file</button>
        </div>)}
    </div>
  );
}
