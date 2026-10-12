import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

const CATEGORIES = ["Sheet", "Dashboard", "Document", "Report", "Other"];
const fmtSize = (n) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function DocumentsPage({ user, isStaffLayout, onLogout, onBack }) {
  const [data, setData] = useState(null);
  const [dept, setDept] = useState("All");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };
  const isAdmin = user.role === "admin";

  const load = () => api.listDocuments().then(setData).catch(() => setData({ documents: [], departments: [] }));
  useEffect(() => { load(); }, []);

  const docs = data?.documents || [];
  const folders = useMemo(() => {
    const m = new Map();
    for (const d of docs) m.set(d.department || "No department", (m.get(d.department || "No department") || 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [docs]);
  const shown = docs.filter((d) => (dept === "All" || (d.department || "No department") === dept) && (cat === "All" || d.category === cat)
    && (!q || `${d.title} ${d.uploaded_by_name} ${d.note || ""}`.toLowerCase().includes(q.toLowerCase())));

  async function open(d) {
    if (d.kind === "link") return window.open(d.url, "_blank", "noopener");
    try { await api.downloadDocument(d.id, d.file_name); } catch (e) { flash(e.message); }
  }
  async function remove(d) {
    if (!window.confirm(`Delete "${d.title}"?`)) return;
    try { await api.deleteDocument(d.id); flash("Deleted."); load(); } catch (e) { flash(e.message); }
  }

  return (
    <PageShell user={user} active="Documents" title="Documents" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div>
          <div className="eyebrow">Knowledge</div>
          <h1>Documents</h1>
          <p>{data?.canSeeAll ? "Every department's sheets, dashboards and important documents, in one place. What a department uploads shows up here for admin automatically." : "Your department's sheets, dashboards and documents. Whatever you upload is visible to admin."}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShow(true)}><Icon name="plus" size={16} /> Add document</button>
      </div>

      {data?.canSeeAll && (
        <div className="pill-row">
          <button className={`pill ${dept === "All" ? "active" : ""}`} onClick={() => setDept("All")}>All folders <span className="n">{docs.length}</span></button>
          {folders.map(([name, n]) => <button key={name} className={`pill ${dept === name ? "active" : ""}`} onClick={() => setDept(name)}>{name} <span className="n">{n}</span></button>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input className="field" style={{ maxWidth: 260 }} placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" style={{ maxWidth: 170 }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="All">All types</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {data === null && <div className="empty">Loading…</div>}
      {data && shown.length === 0 && <div className="empty">Nothing here yet. Click “Add document” to upload a file or paste a Google Sheet / dashboard link.</div>}
      <div className="grid-2">
        {shown.map((d) => (
          <div key={d.id} className="card" style={{ marginBottom: 0 }}>
            <div className="person-row">
              <div className="avatar" style={{ borderRadius: 12 }}><Icon name={d.kind === "link" ? "arrow" : "file"} size={18} /></div>
              <div className="info">
                <div className="nm"><span className="link" onClick={() => open(d)}>{d.title}</span></div>
                <div className="sub">{d.kind === "link" ? "Link" : `${d.file_name || "File"} ${fmtSize(d.size)}`}</div>
              </div>
              <span className="badge pending">{d.category}</span>
            </div>
            {d.note && <div className="meta" style={{ marginTop: 8 }}>{d.note}</div>}
            <div className="meta" style={{ marginTop: 8 }}>
              <span className="chip">{d.department || "No department"}</span>
              Uploaded by <strong style={{ color: "var(--ink)" }}>{d.uploaded_by_name || "—"}</strong> · {new Date(d.created_at.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => open(d)}>{d.kind === "link" ? "Open link" : "Download"}</button>
              {(isAdmin || d.uploaded_by === user.id) && <button className="btn btn-ghost btn-sm" onClick={() => remove(d)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {show && <AddDocModal isAdmin={isAdmin} departments={data?.departments || []} defaultDept={data?.myDepartmentId || ""} onClose={() => setShow(false)}
        onDone={(m) => { setShow(false); flash(m); load(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function AddDocModal({ isAdmin, departments, defaultDept, onClose, onDone }) {
  const [mode, setMode] = useState("file");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Document");
  const [departmentId, setDepartmentId] = useState(defaultDept);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("title", title); fd.append("category", category); fd.append("note", note);
      if (isAdmin && departmentId) fd.append("departmentId", departmentId);
      if (mode === "file") { if (!file) throw new Error("Choose a file first"); fd.append("file", file); } else fd.append("url", url);
      await api.addDocument(fd);
      onDone("Added. Admin can see it now.");
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a document</h3>
        <div className="tab-switch" style={{ margin: "12px 0" }}>
          <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>Upload a file</button>
          <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>Paste a link</button>
        </div>
        {mode === "file"
          ? <input className="field" type="file" onChange={(e) => { setFile(e.target.files[0] || null); if (!title && e.target.files[0]) setTitle(e.target.files[0].name.replace(/\.[^.]+$/, "")); }} />
          : <input className="field" placeholder="https://docs.google.com/spreadsheets/…" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Daily collection dashboard" />
        <label className="field-label">Type</label>
        <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        {isAdmin && (<>
          <label className="field-label">Department folder</label>
          <select className="field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">— None —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></>)}
        <label className="field-label">Note (optional)</label>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || (!title.trim() && mode === "link")} onClick={submit}>{busy ? "Uploading…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
