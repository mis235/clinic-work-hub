import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Icon, { initials } from "../components/Icon.jsx";

// Doctor photo is linked from the clinic's own website; if it can't load we fall back to initials.
function DoctorPhoto({ url, name }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="avatar lg" style={{ width: 120, height: 120, fontSize: 38, borderRadius: 28 }}>{initials(name.replace(/^Dr\.?\s*/i, ""))}</div>;
  return <img src={url} alt={name} onError={() => setFailed(true)} referrerPolicy="no-referrer"
    style={{ width: 120, height: 120, borderRadius: 28, objectFit: "cover", objectPosition: "top", background: "var(--surface-sunk)", flexShrink: 0 }} />;
}

export default function AboutPage({ user, onLogout, onBack }) {
  const [about, setAbout] = useState(null);
  const [team, setTeam] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const canManage = user.role === "admin" || user.role === "manager";

  const refreshTeam = () => api.listTeam().then(setTeam).catch(() => setTeam([]));
  useEffect(() => {
    api.getAbout().then(setAbout).catch(() => setAbout(null));
    refreshTeam();
  }, []);

  const c = about?.clinic;
  const f = about?.founder;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="About"
        onSelect={(item) => item !== "About" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="About" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head">
          <div className="eyebrow">Knowledge</div>
          <h1>Clinic Profile</h1>
        </div>

        {c && (
          <div className="clinic-hero">
            <div className="clinic-photo">
              <img src={c.photo} alt="Dr. Nishita's Clinic building" />
              {/* outline + label over the clinic's signboard in the photo */}
              <div className="board-mark" aria-hidden="true"><span>Dr. Nishita's Clinic</span></div>
            </div>
            <div className="clinic-info">
              <div className="eyebrow" style={{ color: "var(--primary)", fontWeight: 700, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Our clinic</div>
              <h2>{c.name}</h2>
              <div className="clinic-tagline">{c.tagline}</div>
              <div className="clinic-line"><Icon name="building" size={17} /><span>{c.address}</span></div>
              <div className="clinic-line"><Icon name="phone" size={17} /><span>{c.phone}</span></div>
              <div className="clinic-line"><Icon name="file" size={17} /><span>{c.email}</span></div>
              <a className="btn btn-outline btn-sm" style={{ marginTop: 14, textDecoration: "none" }} href={c.website} target="_blank" rel="noreferrer">Visit clinic website <Icon name="arrow" size={14} /></a>
            </div>
          </div>
        )}

        {about && (
          <div className="card">
            <p style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0 }}>{about.clinicIntro}</p>
          </div>
        )}

        {f && (
          <div className="card" style={{ padding: 24 }}>
            <div className="person-row" style={{ gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
              <DoctorPhoto url={f.photoUrl} name={f.name} />
              <div className="info" style={{ minWidth: 240 }}>
                <div className="eyebrow" style={{ color: "var(--primary)", fontWeight: 700, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Founder & Medical Director</div>
                <h2 style={{ fontSize: 24, margin: "6px 0 8px" }}>{f.name}</h2>
                <div>
                  <span className="badge teal" style={{ marginRight: 6 }}>Dermatologist</span>
                  {f.experience && <span className="chip">{f.experience} experience</span>}
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: "12px 0 0" }}>{f.bio}</p>
              </div>
            </div>
            <div className="grid-2" style={{ marginTop: 22 }}>
              <div>
                <div className="step-label">Qualifications & training</div>
                <ul className="tick-list">{f.qualifications.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </div>
              <div>
                <div className="step-label">Highlights</div>
                <ul className="tick-list">{f.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
              </div>
            </div>
          </div>
        )}

        {about?.services && (
          <>
            <div className="section-head"><h2>What we do</h2><span className="sub">Skin, hair and aesthetic care</span></div>
            <div className="grid-3">
              {about.services.map((sv) => (
                <div key={sv.name} className="card" style={{ marginBottom: 0 }}>
                  <div className="card-head"><div className="name" style={{ fontSize: 16 }}>{sv.name}</div></div>
                  <ul className="tick-list">{sv.items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
          </>
        )}

        {about && (
          <div className="grid-2" style={{ marginTop: 20 }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="step-label">Vision</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: "8px 0 0" }}>{about.vision}</p>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="step-label">Mission</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: "8px 0 0" }}>{about.mission}</p>
            </div>
          </div>
        )}

        <div className="section-head">
          <h2>Management & Team</h2>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add profile</button>}
        </div>
        {team.length === 0 && <div className="empty">No team profiles added yet.</div>}
        <div className="grid-2">
          {team.map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 0 }}>
              <div className="person-row">
                <div className="avatar">{initials(t.name)}</div>
                <div className="info">
                  <div className="nm">{t.name}</div>
                  {t.title && <div className="sub">{t.title}</div>}
                </div>
              </div>
              {t.bio && <p style={{ fontSize: 13, margin: "12px 0 0", lineHeight: 1.6 }}>{t.bio}</p>}
            </div>
          ))}
        </div>

        {showForm && <TeamForm onClose={() => setShowForm(false)} onAdd={async (p) => { await api.addTeamProfile(p); refreshTeam(); }} />}
      </main>
    </div>
  );
}

function TeamForm({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a team profile</h3>
        <label className="field-label">Name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="field-label">Bio</label>
        <textarea className="field" style={{ minHeight: 80 }} value={bio} onChange={(e) => setBio(e.target.value)} />
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => { onAdd({ name, title, bio }); onClose(); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
