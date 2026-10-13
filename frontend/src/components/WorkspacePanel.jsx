import { useEffect, useState } from "react";
import { api } from "../api.js";

const KINDS = [["sheet", "Sheet"], ["dashboard", "Dashboard"], ["doc", "Document"], ["app", "App / tool"], ["link", "Other link"]];
const ICON = { sheet: "📊", dashboard: "📈", doc: "📄", app: "🧩", link: "🔗" };

// A department's desk: its sheets, dashboards, documents and tools in one place. Anyone in the department (and admin) can add or open.
export default function WorkspacePanel({ deptId, title }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null); // {id?, title, kind, url, note}
  const [open, setOpen] = useState(null); // item shown inside the app
  const load = () => api.workspace(deptId).then((r) => { setD(r); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); setOpen(null); load(); }, [deptId]);

  async function save() {
    try {
      if (form.id) await api.editWorkspaceItem(form.id, form); else await api.addWorkspaceItem(d.department.id, form);
      setForm(null); load();
    } catch (e) { setErr(e.message); }
  }
  async function remove(it) {
    if (!confirm(`Remove “${it.title}” from this workspace? (The file itself is not deleted.)`)) return;
    try { await api.deleteWorkspaceItem(it.id); load(); } catch (e) { setErr(e.message); }
  }
  if (err && !d) return <div className="empty">{err}</div>;
  if (!d) return <div className="empty">Loading…</div>;
  if (!d.department) return <div className="empty">You are not in a department yet. Ask the admin to set your department.</div>;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div><div className="title">{title || `${d.department.name} workspace`}</div>
          <div className="meta">Sheets, dashboards and tools of {d.department.name}. Admin can see everything here.</div></div>
        <button className="btn btn-primary btn-sm" onClick={() => setForm({ title: "", kind: "sheet", url: "", note: "" })}>+ Add to workspace</button>
      </div>
      {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
      {d.items.length === 0 && <div className="empty">Nothing here yet. Add your sheets and dashboards with “Add to workspace”.</div>}
      <div className="dept-grid">
        {d.items.map((it) => (
          <div key={it.id} className="dept-card" style={{ cursor: "default" }}>
            <div className="title">{ICON[it.kind] || "🔗"} {it.title}</div>
            {it.note && <div className="meta" style={{ marginTop: 4 }}>{it.note}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <a className="btn btn-outline btn-sm" href={it.url} target="_blank" rel="noreferrer">Open ↗</a>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open?.id === it.id ? null : it)}>{open?.id === it.id ? "Close preview" : "Preview here"}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...it })}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(it)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="meta" style={{ marginBottom: 8 }}>If this stays blank, the site does not allow showing inside other apps (Google sign-in pages often do not). Use “Open ↗”.</div>
          <iframe title={open.title} src={open.url} style={{ width: "100%", height: 520, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
        </div>
      )}
      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit" : "Add to workspace"}</h3>
            <label className="field-label">Name</label>
            <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Daily MIS sheet" />
            <label className="field-label">Type</label>
            <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="field-label">Link (paste the Google Sheet / dashboard address)</label>
            <input className="field" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            <label className="field-label">Note (optional)</label>
            <input className="field" value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}><button className="btn btn-primary" onClick={save}>Save</button><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button></div>
          </div>
        </div>
      )}
    </>
  );
}
