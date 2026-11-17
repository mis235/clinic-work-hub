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
const BLANK = { title: "", body: "", trigger: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5, 6], date: "", audience: "all", audienceUsers: [], whatsapp: true, active: true };

export default function AutoMessagesPage({ user, onLogout, onBack }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [log, setLog] = useState(null), [waLink, setWaLink] = useState(""), [pick, setPick] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const load = () => api.listAutoMessages().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const flash = (m) => { setOk(m); setTimeout(() => setOk(""), 4000); };

  async function save() {
    try { await api.saveAutoMessage(form.id, form); setForm(null); load(); flash("Saved."); } catch (e) { setErr(e.message); }
  }
  async function toggle(m) { try { await api.saveAutoMessage(m.id, { ...m, active: !m.active }); load(); } catch (e) { setErr(e.message); } }
  async function remove(m) { if (window.confirm(`Delete "${m.title}"?`)) { try { await api.deleteAutoMessage(m.id); load(); } catch (e) { setErr(e.message); } } }
  async function sendNow(m) { if (!window.confirm(`Send "${m.title}" to ${aud(m)} now?`)) return; try { const r = await api.sendAutoMessageNow(m.id); flash(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}${r.skipped ? ` (${r.skipped} already had it today)` : ""}.`); load(); } catch (e) { setErr(e.message); } }
  async function showLog(m) { try { setLog(await api.autoMessageLog(m.id)); } catch (e) { setErr(e.message); } }
  async function saveWa() { try { const r = await api.setWhatsappLink(waLink.trim()); flash(r.connected ? "WhatsApp connected." : "WhatsApp link removed."); setWaLink(""); load(); } catch (e) { setErr(e.message); } }
  const aud = (m) => m.audience === "all" ? "All staff" : m.audience === "users" ? `${m.audienceUsers.length} chosen ${m.audienceUsers.length === 1 ? "person" : "people"}` : data?.departments.find((d) => d.id === m.audience)?.name || "Department";
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
          <div><h1>Auto Messages</h1></div>
          <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...BLANK })}>+ New Message</button>
        </div>
        {data && (
          <div className="card" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 13.5 }}>
            <b>How messages go out:</b>
            <span>● In the app: <b style={{ color: "#16a34a" }}>on</b></span>
            <span>● Email: <b style={{ color: data.channels.email ? "#16a34a" : "#b45309" }}>{data.channels.email ? "on" : "not set up"}</b></span>
            <span>● WhatsApp: <b style={{ color: data.channels.whatsapp ? "#16a34a" : "#b45309" }}>{data.channels.whatsapp ? "connected" : "not connected"}</b></span>
            {!data.channels.whatsapp && user.role === "admin" && (
              <span style={{ display: "flex", gap: 6, flex: 1, minWidth: 260 }}>
                <input className="field" style={{ margin: 0 }} placeholder="Paste the TeleCRM link (https://…) to connect WhatsApp" value={waLink} onChange={(e) => setWaLink(e.target.value)} />
                <button className="btn btn-primary btn-sm" disabled={!waLink.trim()} onClick={saveWa}>Connect</button>
              </span>)}
          </div>)}
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
                <div className="meta">🗓 {when(m)} · 👥 {aud(m)}{m.whatsapp ? " · WhatsApp on" : ""}{m.lastRun ? ` · last sent ${m.lastRun}` : " · not sent yet"}</div>
                <div style={{ fontSize: 13.5, marginTop: 6, whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                <button className="btn btn-outline btn-sm" onClick={() => test(m)}>Test To Me</button>
                <button className="btn btn-primary btn-sm" onClick={() => sendNow(m)}>Send Now</button>
                <button className="btn btn-ghost btn-sm" onClick={() => showLog(m)}>Who Got It</button>
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
              <select className="field" value={form.audience === "all" || form.audience === "users" ? form.audience : "dept"} onChange={(e) => setForm({ ...form, audience: e.target.value === "dept" ? (data?.departments[0]?.id || "all") : e.target.value })}>
                <option value="all">All staff</option><option value="dept">One department</option><option value="users">Chosen people</option></select>
              {form.audience !== "all" && form.audience !== "users" && <select className="field" style={{ marginTop: 8 }} value={form.audience} onChange={set("audience")}>{data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
              {form.audience === "users" && (
                <div className="cover-pick" style={{ marginTop: 8 }}>{data?.staff.map((p) => (
                  <label key={p.id} className="ms-row"><input type="checkbox" checked={form.audienceUsers.includes(p.id)} onChange={() => setForm({ ...form, audienceUsers: form.audienceUsers.includes(p.id) ? form.audienceUsers.filter((x) => x !== p.id) : [...form.audienceUsers, p.id] })} /> {p.name}</label>))}</div>)}
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13.5 }}>
                <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} /> Also send on WhatsApp (needs TeleCRM connected)
              </label>
              <div className="actions">
                <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.title.trim() || !form.body.trim()} onClick={save}>Save</button>
              </div>
            </div>
          </div>)}
        {log && (
          <div className="modal-backdrop" onClick={() => setLog(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: 640 }}>
              <h3>{log.title}</h3>
              <div className="meta" style={{ marginBottom: 8 }}>{log.people.filter((p) => p.sent).length} of {log.people.length} received it · {log.people.filter((p) => p.read).length} read it</div>
              <table className="cat-table" style={{ width: "100%", fontSize: 13 }}><thead><tr><th style={{ textAlign: "left" }}>Name</th><th>Received</th><th>Read</th><th>Email</th><th>WhatsApp</th></tr></thead>
                <tbody>{log.people.map((p) => (<tr key={p.id}><td>{p.name}</td><td style={{ textAlign: "center" }}>{p.sent ? `✓ ${p.date.slice(5)}` : <span style={{ color: "#b45309" }}>Pending</span>}</td><td style={{ textAlign: "center" }}>{p.read ? "✓" : "—"}</td><td style={{ textAlign: "center" }}>{p.email || "—"}</td><td style={{ textAlign: "center" }}>{p.whatsapp || "—"}</td></tr>))}</tbody></table>
              <div className="actions"><button className="btn btn-primary" onClick={() => setLog(null)}>Close</button></div>
            </div>
          </div>)}
      </div>
    </div>
  );
}
