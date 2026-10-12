import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function EventsPage({ user, onLogout, onBack }) {
  const [events, setEvents] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const canManage = user.role === "admin" || user.role === "manager";

  const refresh = () => api.getEvents().then(setEvents).catch(() => setEvents(null));
  useEffect(() => { refresh(); }, []);

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Events"
        onSelect={(item) => item !== "Events" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Upcoming Events" onOpenMenu={() => setMobileOpen(true)} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="page-head"><h1>Events & Culture</h1></div>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add festival / date</button>}
        </div>

        {events === null && <div className="empty">Loading…</div>}

        {events?.note && <div className="note">{events.note}</div>}

        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 10px" }}>Birthdays</h2>
        <div className="card">
          {(events?.birthdays || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No birthdates on file yet.</div>}
          {(events?.birthdays || []).map((b, i) => (
            <div key={i} className="task-row"><div className="title">{b.name}</div><div>{b.birthday}</div></div>
          ))}
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 10px" }}>Festivals & Important Dates</h2>
        <div className="card">
          {(events?.festivalsAndImportantDates || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>None added yet.</div>}
          {(events?.festivalsAndImportantDates || []).map((f) => (
            <div key={f.id} className="task-row"><div className="title">{f.title}</div><div style={{ fontSize: 12.5 }}>{f.event_date} · {f.event_type}</div></div>
          ))}
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 10px" }}>Years of Experience</h2>
        <div className="card">
          {(events?.yearsOfExperience || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No join dates on file yet.</div>}
          {(events?.yearsOfExperience || []).map((y, i) => (
            <div key={i} className="task-row"><div className="title">{y.name}</div><div style={{ fontSize: 12.5 }}>{y.years} yrs · joined {y.joinedAt}</div></div>
          ))}
        </div>

        {showForm && <EventForm onClose={() => setShowForm(false)} onAdd={async (p) => { await api.addEvent(p); refresh(); }} />}
      </div>
    </div>
  );
}

function EventForm({ onClose, onAdd }) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("festival");
  const [eventDate, setEventDate] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a festival or important date</h3>
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali" />
        <label className="field-label">Type</label>
        <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="festival">Festival</option>
          <option value="important_date">Clinic Important Date</option>
          <option value="event">One-off Event</option>
        </select>
        <label className="field-label">Date (MM-DD for yearly, or full date for one-off)</label>
        <input className="field" value={eventDate} onChange={(e) => setEventDate(e.target.value)} placeholder="e.g. 11-01 or 2026-11-01" />
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim() || !eventDate.trim()} onClick={() => { onAdd({ title, eventType, eventDate }); onClose(); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
