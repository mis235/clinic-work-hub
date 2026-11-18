import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import Avatar from "../components/Avatar.jsx";
import PageShell from "../components/PageShell.jsx";

const STATUS = { open: ["Open", "st-draft"], in_progress: ["Being looked at", "st-prog"], resolved: ["Solved", "st-sent"] };
const when = (iso) => new Date(String(iso).replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Help & Messages: raise a problem to the admin team, and chat with anyone in the clinic.
export default function HelpPage({ user, isStaffLayout, onLogout, onBack, start }) {
  const [tab, setTab] = useState(start === "dm" ? "chat" : "help");
  return (
    <PageShell user={user} active="Help" title="Help & Messages" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head"><div className="eyebrow">Support</div><h1>Help &amp; Messages</h1></div>
      <div className="seg" style={{ margin: "0 0 14px" }}>
        <button className={tab === "help" ? "on" : ""} onClick={() => setTab("help")}>Help desk</button>
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Messages</button>
      </div>
      {tab === "help" ? <HelpDesk user={user} /> : <Chat user={user} />}
    </PageShell>
  );
}

function HelpDesk({ user }) {
  const [data, setData] = useState(null), [filter, setFilter] = useState("open"), [open, setOpen] = useState(null), [form, setForm] = useState(null);
  const load = () => api.tickets().then(setData).catch(() => setData({ rows: [], canManage: false }));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);
  if (open) return <Thread id={open} onBack={() => { setOpen(null); load(); }} />;
  const rows = (data?.rows || []).filter((r) => filter === "all" || (filter === "open" ? r.status !== "resolved" : r.status === "resolved"));
  const n = (f) => (data?.rows || []).filter((r) => (f === "open" ? r.status !== "resolved" : r.status === "resolved")).length;
  return (
    <>
      <div className="card pay-panel">
        <div className="pay-panel-head">
          <div><h2>{data?.canManage ? "Staff requests" : "My requests"}</h2><p>{data?.canManage ? "Questions and problems from staff. Reply to help, then mark solved." : "Having a problem with the app or your work? Tell us here. We will reply."}</p></div>
          <button className="btn btn-primary btn-sm" onClick={() => setForm({ subject: "", category: "App problem", priority: "normal", body: "" })}><Icon name="plus" size={14} /> {data?.canManage ? "New request" : "Ask for help"}</button>
        </div>
        <div className="seg">{[["open", "Open", n("open")], ["resolved", "Solved", n("resolved")], ["all", "All", (data?.rows || []).length]].map(([k, l, c]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l} <span>{c}</span></button>)}</div>
        {data === null && <div className="empty">Loading…</div>}
        {data && rows.length === 0 && <div className="empty">{filter === "open" ? "Nothing waiting. All good." : "Nothing here yet."}</div>}
        {rows.length > 0 && <div className="pay-table-wrap"><table className="pay-table">
          <thead><tr><th>Request</th>{data.canManage && <th>From</th>}<th>Category</th><th>Status</th><th className="r">Updated</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="clickrow" onClick={() => setOpen(r.id)}>
              <td><div className="pt-name">{r.priority === "urgent" && <span className="urgent">Urgent</span>}{r.subject}</div><div className="pt-sub">{r.replies} message{r.replies === 1 ? "" : "s"}</div></td>
              {data.canManage && <td><div className="pt-name">{r.user_name}</div><div className="pt-sub">{r.department || ""}</div></td>}
              <td>{r.category}</td>
              <td><span className={`st ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
              <td className="r pt-sub">{when(r.updated_at)}</td>
            </tr>))}</tbody>
        </table></div>}
      </div>
      {form && <NewTicket form={form} setForm={setForm} onClose={() => setForm(null)} onDone={(id) => { setForm(null); load(); setOpen(id); }} />}
    </>
  );
}

function NewTicket({ form, setForm, onClose, onDone }) {
  const [cats, setCats] = useState([]), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api.helpCategories().then(setCats).catch(() => {}); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target.checked ? "urgent" : "normal") : e.target.value }));
  async function send() { setBusy(true); setErr(""); try { const r = await api.raiseTicket(form); onDone(r.id); } catch (e) { setErr(e.message); setBusy(false); } }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Ask for help</h3>
      <label className="field-label">What is the problem? (short title)</label>
      <input className="field" autoFocus value={form.subject} onChange={set("subject")} placeholder="e.g. I cannot see my payslip" />
      <label className="field-label" style={{ marginTop: 10 }}>Type</label>
      <select className="field" value={form.category} onChange={set("category")}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
      <label className="field-label" style={{ marginTop: 10 }}>Tell us what happened</label>
      <textarea className="field" rows={4} value={form.body} onChange={set("body")} placeholder="What did you do? What did you see?" />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13.5 }}><input type="checkbox" checked={form.priority === "urgent"} onChange={set("priority")} /> This is urgent</label>
      {err && <div className="error">{err}</div>}
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={send}>Send</button></div>
    </div></div>
  );
}

function Thread({ id, onBack }) {
  const [d, setD] = useState(null), [text, setText] = useState(""), [err, setErr] = useState(""), end = useRef(null);
  const load = () => api.ticket(id).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [d?.replies?.length]);
  async function send() { if (!text.trim()) return; try { await api.replyTicket(id, text); setText(""); load(); } catch (e) { setErr(e.message); } }
  async function status(s) { try { await api.setTicketStatus(id, s); load(); } catch (e) { setErr(e.message); } }
  if (!d) return <div className="empty">{err || "Loading…"}</div>;
  const t = d.ticket;
  return (
    <div className="card pay-panel">
      <div className="pay-panel-head">
        <div><button className="bell-link" onClick={onBack}><Icon name="back" size={13} /> All requests</button><h2 style={{ marginTop: 6 }}>{t.subject}</h2>
          <p>{t.user_name} · {t.category} · <span className={`st ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span></p></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.canManage && t.status !== "in_progress" && t.status !== "resolved" && <button className="btn btn-ghost btn-sm" onClick={() => status("in_progress")}>I am looking at it</button>}
          {t.status !== "resolved" ? <button className="btn btn-primary btn-sm" onClick={() => status("resolved")}><Icon name="check" size={14} /> Mark solved</button> : d.canManage && <button className="btn btn-ghost btn-sm" onClick={() => status("open")}>Open again</button>}
        </div>
      </div>
      <div className="chat-thread">
        {d.replies.map((r) => (
          <div key={r.id} className={`bubble ${r.mine ? "me" : "them"}`}><div className="b-name">{r.mine ? "You" : r.name}{!r.fromStaff && <span className="b-tag">Support</span>}</div><div className="b-text">{r.body}</div><div className="b-time">{when(r.createdAt)}</div></div>))}
        <div ref={end} />
      </div>
      {err && <div className="error" style={{ margin: "0 20px" }}>{err}</div>}
      <div className="chat-box"><textarea className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your reply…" /><button className="btn btn-primary" onClick={send}><Icon name="send" size={15} /> Send</button></div>
    </div>
  );
}

function Chat({ user }) {
  const [people, setPeople] = useState(null), [sel, setSel] = useState(null), [q, setQ] = useState("");
  const load = () => api.chatPeople().then(setPeople).catch(() => setPeople([]));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  const list = (people || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="chat-layout">
      <div className={`chat-people ${sel ? "hide-sm" : ""}`}>
        <input className="field" placeholder="Search a person…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chat-plist">
          {people === null && <div className="empty">Loading…</div>}
          {list.map((p) => (
            <button key={p.id} className={`chat-person ${sel?.id === p.id ? "on" : ""}`} onClick={() => setSel(p)}>
              <Avatar id={p.id} name={p.name} hasPhoto={p.hasPhoto} size={36} />
              <span className="cp-txt"><span className="cp-name">{p.name}{p.isAdmin && <span className="b-tag">Admin</span>}</span><span className="cp-last">{p.lastBody || p.designation || p.department || ""}</span></span>
              {p.unread > 0 && <span className="bell-count static">{p.unread}</span>}
            </button>))}
        </div>
      </div>
      <div className={`chat-main ${sel ? "" : "hide-sm"}`}>
        {sel ? <Conversation key={sel.id} person={sel} onBack={() => { setSel(null); load(); }} onSent={load} /> : <div className="empty" style={{ margin: "auto" }}>Choose a person to start a message.</div>}
      </div>
    </div>
  );
}

function Conversation({ person, onBack, onSent }) {
  const [d, setD] = useState(null), [text, setText] = useState(""), [err, setErr] = useState(""), end = useRef(null);
  const load = () => api.chatWith(person.id).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [person.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [d?.messages?.length]);
  async function send() { if (!text.trim()) return; try { await api.chatSend(person.id, text); setText(""); load(); onSent?.(); } catch (e) { setErr(e.message); } }
  return (
    <>
      <div className="chat-head"><button className="bell-link show-sm" onClick={onBack}><Icon name="back" size={14} /></button><Avatar id={person.id} name={person.name} hasPhoto={person.hasPhoto} size={34} /><div><b>{person.name}</b><div className="pt-sub">{person.designation || person.department || ""}</div></div></div>
      <div className="chat-thread">
        {d?.messages?.length === 0 && <div className="empty">No messages yet. Say hello.</div>}
        {(d?.messages || []).map((m) => <div key={m.id} className={`bubble ${m.mine ? "me" : "them"}`}><div className="b-text">{m.body}</div><div className="b-time">{when(m.createdAt)}</div></div>)}
        <div ref={end} />
      </div>
      {err && <div className="error" style={{ margin: "0 14px" }}>{err}</div>}
      <div className="chat-box"><textarea className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Message ${person.name.split(" ")[0]}…`} /><button className="btn btn-primary" onClick={send}><Icon name="send" size={15} /> Send</button></div>
    </>
  );
}
