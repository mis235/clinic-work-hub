import { useEffect, useState } from "react";
import { api, videoStreamUrl } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import Icon from "../components/Icon.jsx";

const embedUrl = (u = "") => {
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const dr = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (dr) return `https://drive.google.com/file/d/${dr[1]}/preview`;
  const vm = u.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
};

const shareInfo = (v) => {
  const link = v.is_upload ? window.location.origin : v.url;
  const text = `${v.title}${v.folder ? " (" + v.folder + ")" : ""}\n${link}`;
  return { link, text: v.is_upload ? `${v.title} - training from Dr. Nishita's Clinic. Open the Work Hub app and find it in Training Library.\n${link}` : text };
};
// Anyone can pass a training video on: WhatsApp, email or copy the link.
function ShareMenu({ v, open }) {
  const { link, text } = shareInfo(v);
  const [done, setDone] = useState("");
  const items = (
    <div style={{ display: "grid", gap: 2, minWidth: 150 }}>
      <a className="btn btn-ghost btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
      <a className="btn btn-ghost btn-sm" href={`mailto:?subject=${encodeURIComponent("Training: " + v.title)}&body=${encodeURIComponent(text)}`}>Email</a>
      <button className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setDone("Copied"); setTimeout(() => setDone(""), 1500); } catch {} }}>{done || "Copy Link"}</button>
    </div>);
  if (open) return <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span className="meta">Share:</span>{items.props.children}</div>;
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn btn-outline btn-sm" style={{ listStyle: "none", cursor: "pointer" }}>Share</summary>
      <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", padding: 6 }}>{items}</div>
    </details>
  );
}

export default function LearningPage({ user, isStaffLayout, onLogout, onBack }) {
  const [videos, setVideos] = useState(null);
  const [form, setForm] = useState(null); // null | {} (new) | video (edit)
  const [bulk, setBulk] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [toast, setToast] = useState("");
  const canManage = user.role === "admin";
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const refresh = () => api.listTrainingVideos().then(setVideos).catch(() => setVideos([]));
  useEffect(() => { refresh(); }, []);

  async function markWatched(id) { await api.markVideoWatched(id); refresh(); }
  async function remove(v) {
    if (!window.confirm(`Remove "${v.title}" from the library?`)) return;
    try { await api.deleteTrainingVideo(v.id); flash("Removed."); refresh(); } catch (e) { flash(e.message); }
  }
  async function move(list, i, dir) {
    const a = list[i], b = list[i + dir]; if (!b) return;
    await Promise.all([api.updateTrainingVideo(a.id, { sortOrder: b.sort_order }), api.updateTrainingVideo(b.id, { sortOrder: a.sort_order })]);
    refresh();
  }

  const [q, setQ] = useState(""), [deptF, setDeptF] = useState("");
  const all = videos || [];
  const ql = q.trim().toLowerCase();
  const shown = all.filter((v) => (!deptF || v.department === deptF) && (!ql || `${v.title} ${v.folder || ""} ${v.department} ${v.description || ""}`.toLowerCase().includes(ql)));
  const stat = (list) => ({ n: list.length, done: list.filter((v) => v.watchedByMe).length });
  const grouped = shown.reduce((acc, v) => { (acc[v.department] ||= []).push(v); return acc; }, {});
  const foldersOf = (vids) => vids.reduce((acc, v) => { (acc[v.folder || ""] ||= []).push(v); return acc; }, {});
  const [openFolders, setOpenFolders] = useState({});
  const toggle = (k) => setOpenFolders((o) => ({ ...o, [k]: o[k] === false ? true : false }));
  async function renameFolder(dept, from) {
    const to = window.prompt("New folder name", from); if (!to || to === from) return;
    try { await api.renameFolder({ department: dept, from, to }); refresh(); } catch (e) { flash(e.message); }
  }
  const departments = [...new Set([...(videos || []).map((v) => v.department)])];

  return (
    <PageShell user={user} active="Learning" title="Training Library" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Knowledge</div><h1>Training Library</h1></div>
        {canManage && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-outline" onClick={() => setBulk(true)}>Bulk Add From List</button>
          <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={16} /> Add Video / File</button></div>}
      </div>

      {videos?.length > 0 && (() => {
        return (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 8px" }}>
              <input className="field" style={{ flex: "1 1 220px", maxWidth: 360, margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos, folders, topics…" />
              <button className={`btn btn-sm ${deptF ? "btn-outline" : "btn-primary"}`} onClick={() => setDeptF("")}>All</button>
              {departments.map((d) => { const st = stat(all.filter((v) => v.department === d)); return (
                <button key={d} className={`btn btn-sm ${deptF === d ? "btn-primary" : "btn-outline"}`} onClick={() => setDeptF(deptF === d ? "" : d)}>{d} · {st.n}</button>); })}
            </div>
            {shown.length === 0 && <div className="empty">Nothing matches. Clear the search or choose All.</div>}
          </div>);
      })()}

      {videos === null && <div className="empty">Loading…</div>}
      {videos?.length === 0 && <div className="empty">Nothing in the library yet.{canManage ? " Click “Add video” to start." : ""}</div>}

      {Object.entries(grouped).map(([dept, vids]) => (
        <div key={dept} className="card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>📁 {dept} <span className="meta">· {vids.length} item{vids.length === 1 ? "" : "s"}</span></div>
          {Object.entries(foldersOf(vids)).sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map(([folder, items]) => {
            const key = dept + "/" + folder, onlyOne = Object.keys(foldersOf(vids)).length === 1, isOpen = openFolders[key] === undefined ? (onlyOne || !!ql) : openFolders[key] !== false;
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                {(folder || Object.keys(foldersOf(vids)).length > 1) && (
                  <div className="folder-head" onClick={() => toggle(key)}>
                    <span>{isOpen ? "▾" : "▸"} {folder ? "📂 " + folder : "Not in a folder"} <span className="meta">· {items.length}</span></span>
                  </div>)}
                {isOpen && items.map((v, i) => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface-sunk, #f1f5f9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>{v.kind === "file" ? "📄" : "▶"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="link" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "normal", wordBreak: "break-word" }} onClick={() => (v.kind === "file" || (!v.is_upload && !embedUrl(v.url) && false)) ? window.open(videoStreamUrl(v.id), "_blank") : setPlaying(v)}>{v.title}</div>
                      {v.description && <div className="meta">{v.description}</div>}
                      {v.kind === "file" && v.file_name && <div className="meta">{v.file_name}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <ShareMenu v={v} />
                      {canManage && (
                        <details style={{ position: "relative" }}>
                          <summary className="btn btn-ghost btn-sm" style={{ listStyle: "none", cursor: "pointer" }}>⋯</summary>
                          <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", padding: 6, display: "grid", gap: 2, minWidth: 120 }}>
                            <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(items, i, -1)}>↑ Move Up</button>
                            <button className="btn btn-ghost btn-sm" disabled={i === items.length - 1} onClick={() => move(items, i, 1)}>↓ Move Down</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setForm(v)}>Edit</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => remove(v)}>Remove</button>
                          </div>
                        </details>)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}

      {playing && (
        <div className="modal-backdrop" onClick={() => setPlaying(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>{playing.title}</h3>
            {playing.is_upload ? (playing.kind === "file" ? null : <video src={videoStreamUrl(playing.id)} controls autoPlay style={{ width: "100%", borderRadius: 12, marginTop: 12, background: "#000" }} />)
              : embedUrl(playing.url) ? <iframe title={playing.title} src={embedUrl(playing.url)} allow="autoplay; fullscreen" allowFullScreen style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 12, marginTop: 12 }} />
              : <p className="lead" style={{ marginTop: 12 }}>This link opens on its own page: <a href={playing.url} target="_blank" rel="noreferrer">{playing.url}</a></p>}
            <div className="actions">
              <ShareMenu v={playing} open />
              <button className="btn btn-primary" onClick={() => setPlaying(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {form && <VideoForm initial={form} departments={departments} existingFolders={[...new Set((videos || []).map((v) => v.folder).filter(Boolean))]} onClose={() => setForm(null)} onDone={(m) => { setForm(null); flash(m); refresh(); }} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} onDone={(m) => { setBulk(false); flash(m); refresh(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function VideoForm({ initial, departments, existingFolders = [], onClose, onDone }) {
  const editing = !!initial.id;
  const [mode, setMode] = useState("file");
  const [department, setDepartment] = useState(initial.department || departments[0] || "All Staff");
  const [title, setTitle] = useState(initial.title || "");
  const [description, setDescription] = useState(initial.description || "");
  const [folder, setFolder] = useState(initial.folder || "");
  const [url, setUrl] = useState(initial.is_upload ? "" : initial.url || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [custom, setCustom] = useState(false);
  const deptOptions = [...new Set(["All Staff", "Front Desk", "Therapist", "MDO", "Doctors", "Pharmacy", "Floor Coordinator", "Finance", "Supporting Staff", "Management", ...departments])];

  async function save() {
    setBusy(true); setErr("");
    try {
      if (editing) await api.updateTrainingVideo(initial.id, { title, department, description, url, folder });
      else {
        const fd = new FormData();
        fd.append("department", department); fd.append("folder", folder); fd.append("title", title); fd.append("description", description);
        if (mode === "file") { if (!file) throw new Error("Choose a file"); fd.append("file", file); } else fd.append("url", url);
        await api.addTrainingVideoForm(fd);
      }
      onDone(editing ? "Saved." : "Video added.");
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? "Edit video" : "Add a training video"}</h3>
        {!editing && (
          <div className="tab-switch" style={{ margin: "12px 0" }}>
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>Upload file</button>
            <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>Paste link</button>
          </div>)}
        {!editing && mode === "file" && <input className="field" type="file" accept="video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,image/*" onChange={(e) => { const f = e.target.files[0]; setFile(f || null); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />}
        {(editing ? !initial.is_upload : mode === "link") && <input className="field" placeholder="https://youtube.com/…  or a Google Drive share link" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field-label">Who should watch it?</label>
        {custom
          ? <input className="field" autoFocus placeholder="New department name" value={department} onChange={(e) => setDepartment(e.target.value)} />
          : <select className="field" value={department} onChange={(e) => e.target.value === "__new" ? (setCustom(true), setDepartment("")) : setDepartment(e.target.value)}>
              {deptOptions.map((d) => <option key={d} value={d}>{d === "All Staff" ? "All Staff (everyone)" : d}</option>)}
              <option value="__new">+ New group…</option></select>}
        <label className="field-label">Folder (optional)</label>
        <input className="field" list="folder-list" placeholder="e.g. Onboarding, Patient handling" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <datalist id="folder-list">{existingFolders.map((f) => <option key={f} value={f} />)}</datalist>
        <label className="field-label">Short description (optional)</label>
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
        {busy && !editing && mode === "file" && <div className="meta" style={{ marginTop: 10 }}>Uploading — large files can take a few minutes. Please keep this window open.</div>}
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !title.trim() || !department.trim()} onClick={save}>{busy ? "Saving…" : editing ? "Save" : "Add video"}</button>
        </div>
      </div>
    </div>
  );
}

function BulkModal({ onClose, onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rows = text.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 4 && /^https?:\/\//i.test(p[3]))
    .map(([department, folder, title, url]) => ({ department, folder, title, url }));
  async function go() {
    setBusy(true); setErr("");
    try { const r = await api.bulkAddTrainingVideos(rows); onDone(`${r.added} added${r.skipped ? `, ${r.skipped} skipped (already there or incomplete)` : ""}.`); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>Bulk Add From List</h3>
        <p className="meta">One video per line, in this order: <b>Department | Folder | Title | Link</b>. Videos already in the library are skipped.</p>
        <textarea className="field" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Therapist | LT | LT 1 | https://drive.google.com/file/d/…/view" style={{ fontSize: 13, fontFamily: "monospace" }} />
        <div className="meta" style={{ marginTop: 6 }}>{rows.length} valid line{rows.length === 1 ? "" : "s"} found.</div>
        {err && <div className="meta" style={{ color: "var(--danger, #c00)" }}>{err}</div>}
        <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !rows.length} onClick={go}>{busy ? "Adding…" : `Add ${rows.length} Videos`}</button></div>
      </div>
    </div>
  );
}
