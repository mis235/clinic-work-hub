import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const WHEN = {
  daily: "Every day", weekly: "On certain days of the week", once: "One date only",
  birthday: "On each person's birthday (goes to the birthday person)", birthday_team: "When someone has a birthday (goes to everyone else)", anniversary: "On each person's work anniversary", event: "On festival / event days (from Events & Culture)",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IDEAS = [
  { title: "Happy Birthday, {name}!", body: "Dear {name}, wishing you a very happy birthday from all of us at Dr. Nishita's Clinic. Thank you for being part of our family. Have a wonderful day!", trigger: "birthday", time: "09:00" },
  { title: "Today is {person}'s birthday", body: "Hi {name}, today is {person}'s birthday. Please wish {person} a very happy birthday when you meet!", trigger: "birthday_team", time: "09:00" },
  { title: "Happy Work Anniversary!", body: "Hi {name}, congratulations on completing {years} year(s) with us. We are grateful for your hard work and care for our patients.", trigger: "anniversary", time: "09:00" },
  { title: "Happy {event}!", body: "Dear {name}, wishing you and your family a very happy {event} from Dr. Nishita's Clinic.", trigger: "event", time: "08:30" },
  { title: "Good Morning Team", body: "Good morning {name}. Please check your tasks and shift checklist for today. Have a great day!", trigger: "daily", time: "08:45" },
];
const BLANK = { title: "", body: "", trigger: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5, 6], date: "", audience: "all", whatsapp: true, active: true };

export default function AutoMessagesPage({ user, onLogout, onBack }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const load = () => api.listAutoMessages().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const flash = (m) => { setOk(m); setTimeout(() => setOk(""), 4000); };

  async function save() {
    try { await api.saveAutoMessage(form.id, form); setForm(null); load(); flash("Saved."); } catch (e) { setErr(e.message); }
  }
  async function toggle(m) { try { await api.saveAutoMessage(m.id, { ...m, active: !m.active }); load(); } catch (e) { setErr(e.message); } }
  async function remove(m) { if (window.confirm(`Delete "${m.title}"?`)) { try { await api.deleteAutoMessage(m.id); load(); } catch (e) { setErr(e.message); } } }
  async function test(m) { try { const r = await api.testAutoMessage(m.id); flash("Sent to you only. Check your app banner" + (r.whatsapp ? " and WhatsApp." : ".")); } catch (e) { setErr(e.message); } }
  const when = (m) => m.trigger === "weekly" ? `${m.weekdays.map((d) => DAYS[d]).join(", ")} at ${m.time}` : m.trigger === "once" ? `${m.date} at ${m.time}` : `${WHEN[m.trigger]} at ${m.time}`;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Auto Messages" onSelect={(i) => i !== "Auto Messages" && onBack(i)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Auto Messages" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head row">
          <div><h1>Auto Messages</h1><p>Write a message once. It goes to your staff by itself, at the time you choose: in the app, by email, and by WhatsApp when TeleCRM is connected.</p></div>
          <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...BLANK })}>+ New Message</button>
        </div>
        {err && <div className="login-error" style={{ marginBottom: 10 }}>{err}</div>}
        {ok && <div className="card" style={{ borderLeft: "4px solid #16a34a" }}>{ok}</div>}

        {data && data.messages.length === 0 && (
          <div className="card">
            <b>Quick start. Tap one to use it:</b>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {IDEAS.map((i) => <button key={i.title} className="btn btn-outline btn-sm" onClick={() => setForm({ ...BLANK, ...i })}>{i.title.replace("{name}", "").replace("{event}", "Festival")}</button>)}
            </div>
          </div>)}

        {data?.messages.map((m) => (
          <div key={m.id} className="card" style={{ opacity: m.active ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="title">{m.title} {!m.active && <span className="badge">Paused</span>}</div>
                <div className="meta">🗓 {when(m)} · 👥 {m.audience === "all" ? "All staff" : data.departments.find((d) => d.id === m.audience)?.name || "Department"}{m.whatsapp ? " · WhatsApp on" : ""}</div>
                <div style={{ fontSize: 13.5, marginTop: 6, whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                <button className="btn btn-outline btn-sm" onClick={() => test(m)}>Test To Me</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm(m)}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(m)}>{m.active ? "Pause" : "Resume"}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(m)}>Delete</button>
              </div>
            </div>
          </div>))}
        {!data && !err && <div className="empty">Loading…</div>}

        {form && (
          <div className="modal-backdrop" onClick={() => setForm(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
              <h3>{form.id ? "Edit Message" : "New Auto Message"}</h3>
              <label className="field-label">Title</label>
              <input className="field" value={form.title} onChange={set("title")} placeholder="e.g. Happy Birthday, {name}!" />
              <label className="field-label">Message</label>
              <textarea className="field" rows={5} value={form.body} onChange={set("body")} placeholder="Write the message. {name} becomes each person's first name." />
              <div className="meta" style={{ marginTop: 4 }}>Use <b>{"{name}"}</b> for the first name, <b>{"{years}"}</b> for work anniversary years, <b>{"{event}"}</b> for the festival name, <b>{"{person}"}</b> for the birthday person (team message).</div>
              <label className="field-label">When should it go?</label>
              <select className="field" value={form.trigger} onChange={set("trigger")}>{Object.entries(WHEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {form.trigger === "weekly" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {DAYS.map((d, i) => { const on = form.weekdays.includes(i); return <button key={d} type="button" className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`} onClick={() => setForm({ ...form, weekdays: on ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i] })}>{d}</button>; })}
                </div>)}
              {form.trigger === "once" && <input className="field" type="date" style={{ marginTop: 8 }} value={form.date} onChange={set("date")} />}
              <label className="field-label">Time</label>
              <input className="field" type="time" value={form.time} onChange={set("time")} />
              <label className="field-label">Who gets it?</label>
              <select className="field" value={form.audience} onChange={set("audience")}><option value="all">All staff</option>{data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}</select>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13.5 }}>
                <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} /> Also send on WhatsApp (needs TeleCRM connected)
              </label>
              <div className="actions">
                <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.title.trim() || !form.body.trim()} onClick={save}>Save</button>
              </div>
            </div>
          </div>)}
      </div>
    </div>
  );
}
