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

export default function LearningPage({ user, isStaffLayout, onLogout, onBack }) {
  const [videos, setVideos] = useState(null);
  const [form, setForm] = useState(null); // null | {} (new) | video (edit)
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

  const grouped = (videos || []).reduce((acc, v) => { (acc[v.department] ||= []).push(v); return acc; }, {});
  const departments = [...new Set([...(videos || []).map((v) => v.department)])];

  return (
    <PageShell user={user} active="Learning" title="Training Library" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Knowledge</div><h1>Training Library</h1>
          <p>Short training videos, organised by department. {canManage ? "Upload a video file or paste a YouTube / Google Drive link, then reorder, edit or remove as you like." : "Watch what is meant for your department, then tick it off."}</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={16} /> Add video</button>}
      </div>

      {videos === null && <div className="empty">Loading…</div>}
      {videos?.length === 0 && <div className="empty">No training videos yet.{canManage ? " Click “Add video” to start." : ""}</div>}

      {Object.entries(grouped).map(([dept, vids]) => (
        <div key={dept} className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{dept} <span className="meta">· {vids.length} video{vids.length === 1 ? "" : "s"}</span></div>
          {vids.map((v, i) => (
            <div key={v.id} className="task-row">
              <div>
                <span className="link" style={{ fontSize: 13.5, fontWeight: 600 }} onClick={() => setPlaying(v)}>▶ {v.title}</span>
                {v.description && <div className="meta">{v.description}</div>}
              </div>
              <div className="right" style={{ gap: 6 }}>
                {canManage && <>
                  <button className="btn btn-ghost btn-sm" title="Move up" disabled={i === 0} onClick={() => move(vids, i, -1)}>↑</button>
                  <button className="btn btn-ghost btn-sm" title="Move down" disabled={i === vids.length - 1} onClick={() => move(vids, i, 1)}>↓</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setForm(v)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(v)}>Remove</button></>}
                {v.watchedByMe ? <span className="badge done">Watched</span>
                  : <button className="btn btn-outline btn-sm" onClick={() => markWatched(v.id)}>Mark watched</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {playing && (
        <div className="modal-backdrop" onClick={() => setPlaying(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>{playing.title}</h3>
            {playing.is_upload ? <video src={videoStreamUrl(playing.id)} controls autoPlay style={{ width: "100%", borderRadius: 12, marginTop: 12, background: "#000" }} />
              : embedUrl(playing.url) ? <iframe title={playing.title} src={embedUrl(playing.url)} allow="autoplay; fullscreen" allowFullScreen style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 12, marginTop: 12 }} />
              : <p className="lead" style={{ marginTop: 12 }}>This link opens on its own page: <a href={playing.url} target="_blank" rel="noreferrer">{playing.url}</a></p>}
            <div className="actions">
              {!playing.watchedByMe && <button className="btn btn-outline" onClick={async () => { await markWatched(playing.id); setPlaying(null); }}>Mark as watched</button>}
              <button className="btn btn-primary" onClick={() => setPlaying(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {form && <VideoForm initial={form} departments={departments} onClose={() => setForm(null)} onDone={(m) => { setForm(null); flash(m); refresh(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function VideoForm({ initial, departments, onClose, onDone }) {
  const editing = !!initial.id;
  const [mode, setMode] = useState("file");
  const [department, setDepartment] = useState(initial.department || departments[0] || "All Staff");
  const [title, setTitle] = useState(initial.title || "");
  const [description, setDescription] = useState(initial.description || "");
  const [url, setUrl] = useState(initial.is_upload ? "" : initial.url || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [custom, setCustom] = useState(false);
  const deptOptions = [...new Set(["All Staff", "Front Desk", "Therapist", "MDO", "Doctors", "Pharmacy", "Floor Coordinator", "Finance", "Supporting Staff", "Management", ...departments])];

  async function save() {
    setBusy(true); setErr("");
    try {
      if (editing) await api.updateTrainingVideo(initial.id, { title, department, description, url });
      else {
        const fd = new FormData();
        fd.append("department", department); fd.append("title", title); fd.append("description", description);
        if (mode === "file") { if (!file) throw new Error("Choose a video file"); fd.append("file", file); } else fd.append("url", url);
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
            <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>Upload video</button>
            <button className={mode === "link" ? "active" : ""} onClick={() => setMode("link")}>Paste link</button>
          </div>)}
        {!editing && mode === "file" && <input className="field" type="file" accept="video/*" onChange={(e) => { const f = e.target.files[0]; setFile(f || null); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />}
        {(editing ? !initial.is_upload : mode === "link") && <input className="field" placeholder="https://youtube.com/…  or a Google Drive share link" value={url} onChange={(e) => setUrl(e.target.value)} />}
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field-label">Who should watch it?</label>
        {custom
          ? <input className="field" autoFocus placeholder="New department name" value={department} onChange={(e) => setDepartment(e.target.value)} />
          : <select className="field" value={department} onChange={(e) => e.target.value === "__new" ? (setCustom(true), setDepartment("")) : setDepartment(e.target.value)}>
              {deptOptions.map((d) => <option key={d} value={d}>{d === "All Staff" ? "All Staff (everyone)" : d}</option>)}
              <option value="__new">+ New group…</option></select>}
        <label className="field-label">Short description (optional)</label>
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
        {busy && !editing && mode === "file" && <div className="meta" style={{ marginTop: 10 }}>Uploading — large videos can take a few minutes. Please keep this window open.</div>}
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !title.trim() || !department.trim()} onClick={save}>{busy ? "Saving…" : editing ? "Save" : "Add video"}</button>
        </div>
      </div>
    </div>
  );
}
