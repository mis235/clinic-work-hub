import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const istMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);
const shift = (month, n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const KIND = { birthday: ["Birthday", "accepted", "🎂"], anniversary: ["Work anniversary", "done", "⭐"], event: ["", "in_progress", "🎉"] };
const TYPE_LABEL = { festival: "Festival", important_date: "Important date", event: "Event" };

export default function EventsPage({ user, onLogout, onBack }) {
  const [month, setMonth] = useState(istMonth());
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null); // null | {} (new) | item (edit)
  const [mobileOpen, setMobileOpen] = useState(false);
  const [err, setErr] = useState("");
  const canManage = user.role === "admin" || !!user.isHr;

  const refresh = () => api.getEvents(month).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); refresh(); }, [month]);

  async function remove(it) {
    if (!window.confirm(`Delete "${it.title}"?`)) return;
    try { await api.deleteEvent(it.id); refresh(); } catch (e) { setErr(e.message); }
  }
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Events"
        onSelect={(item) => item !== "Events" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Events" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head row">
          <div><h1>Events &amp; Culture</h1><p>Birthdays, work anniversaries, festivals and clinic dates, one month at a time.</p></div>
          {canManage && <button className="btn btn-primary btn-sm" onClick={() => setForm({})}>+ Add event</button>}
        </div>

        <div className="month-bar">
          <button className="btn btn-outline btn-sm" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">‹</button>
          <div className="month-name">{data?.label || "…"}</div>
          <button className="btn btn-outline btn-sm" onClick={() => setMonth(shift(month, 1))} aria-label="Next month">›</button>
          {month !== istMonth() && <button className="btn btn-ghost btn-sm" onClick={() => setMonth(istMonth())}>This month</button>}
        </div>

        {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
        {!data && !err && <div className="empty">Loading…</div>}
        {data && data.items.length === 0 && <div className="empty">Nothing in {data.label}.{canManage && " Use + Add event to add a festival or an important date."}</div>}

        {data && data.items.length > 0 && (
          <div className="card">
            {data.items.map((it, i) => {
              const [tag, tone, icon] = KIND[it.kind] || KIND.event;
              const date = `${month}-${String(it.day).padStart(2, "0")}`;
              return (
                <div key={i} className="task-row event-row">
                  <div className={`event-day ${date === today ? "today" : ""}`}><b>{it.day}</b></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title">{icon} {it.title}</div>
                    <div className="meta">{it.kind === "event" ? TYPE_LABEL[it.eventType] + (it.yearly ? " · every year" : "") : tag}</div>
                  </div>
                  {it.kind === "event" && canManage && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm(it)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(it)}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {form && <EventForm item={form} month={month} onClose={() => setForm(null)}
          onSave={async (p) => { try { form.id ? await api.updateEvent(form.id, p) : await api.addEvent(p); setForm(null); refresh(); } catch (e) { setErr(e.message); setForm(null); } }} />}
      </div>
    </div>
  );
}

function EventForm({ item, month, onClose, onSave }) {
  const edit = !!item.id;
  const [title, setTitle] = useState(item.title || "");
  const [eventType, setEventType] = useState(item.eventType || "festival");
  const [date, setDate] = useState(item.eventDate ? (item.eventDate.length === 5 ? `${month.slice(0, 4)}-${item.eventDate}` : item.eventDate) : `${month}-01`);
  const [yearly, setYearly] = useState(edit ? !!item.yearly : true);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{edit ? "Edit event" : "Add an event"}</h3>
        <label className="field-label">Title</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali" />
        <label className="field-label">Type</label>
        <select className="field" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="festival">Festival</option>
          <option value="important_date">Important date</option>
          <option value="event">Clinic event</option>
        </select>
        <label className="field-label">Date</label>
        <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13.5 }}>
          <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Repeat every year
        </label>
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim() || !date} onClick={() => onSave({ title, eventType, eventDate: yearly ? date.slice(5) : date })}>{edit ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
