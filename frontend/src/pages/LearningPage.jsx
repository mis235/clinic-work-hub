import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function LearningPage({ user, onLogout, onBack }) {
  const [videos, setVideos] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const canManage = user.role === "admin" || user.role === "manager";

  const refresh = () => api.listTrainingVideos().then(setVideos).catch(() => setVideos([]));
  useEffect(() => { refresh(); }, []);

  async function markWatched(id) {
    await api.markVideoWatched(id);
    refresh();
  }

  const grouped = (videos || []).reduce((acc, v) => { (acc[v.department] ||= []).push(v); return acc; }, {});

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Learning"
        onSelect={(item) => item !== "Learning" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Learning & Resources" onOpenMenu={() => setMobileOpen(true)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="page-head"><h1>Training Library</h1><p>Training videos and resources, organised by department.</p></div>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add video</button>}
        </div>

        {videos === null && <div className="empty">Loading…</div>}
        {videos?.length === 0 && <div className="empty">No training videos added yet.</div>}

        {Object.entries(grouped).map(([dept, vids]) => (
          <div key={dept} className="card">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{dept}</div>
            {vids.map((v) => (
              <div key={v.id} className="task-row">
                <div>
                  <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--navy)" }}>{v.title}</a>
                </div>
                <div className="right">
                  {v.watchedByMe ? (
                    <span className="badge done">Watched</span>
                  ) : (
                    <button className="btn btn-sm" style={{ background: "var(--slate-soft)", color: "var(--slate)" }} onClick={() => markWatched(v.id)}>Mark watched</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        {showForm && <VideoForm onClose={() => setShowForm(false)} onAdd={async (p) => { await api.addTrainingVideo(p); refresh(); }} />}
      </div>
    </div>
  );
}

function VideoForm({ onClose, onAdd }) {
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a training video</h3>
        <label className="field-label">Department</label>
        <input className="field" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Front Desk" />
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field-label">Video URL</label>
        <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim() || !url.trim() || !department.trim()} onClick={() => { onAdd({ department, title, url }); onClose(); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
