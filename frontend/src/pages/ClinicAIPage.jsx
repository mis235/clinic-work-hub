import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const IDEAS = [
  "How many new patients came this month?",
  "Show revenue trend for this year",
  "Summarise yesterday's call log",
  "Pharmacy sales this month",
];

// The clinic's n8n "Data Analyst" chat, shown inside the Work Hub. Leadership only.
export default function ClinicAIPage({ user, isStaffLayout, onLogout, onBack }) {
  const isAdmin = user.role === "admin";
  const [cfg, setCfg] = useState(null);
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", content: `Hi ${user.name.split(" ")[0]}. Ask me about patients, procedures, revenue, packages, pharmacy or the call log.` }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef(null);
  const load = () => api.clinicAiConfig().then((c) => { setCfg(c); setUrl(c.url || ""); }).catch(() => setCfg({ configured: false }));
  useEffect(() => { load(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function saveUrl() {
    try { await api.setClinicAiUrl(url); setErr(""); setEditing(false); load(); } catch (e) { setErr(e.message); }
  }
  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", content: q }]); setInput(""); setBusy(true);
    try { const { reply } = await api.askClinicAi(q); setMessages((m) => [...m, { role: "assistant", content: reply }]); }
    catch (e) { setMessages((m) => [...m, { role: "assistant", content: "⚠️ " + e.message }]); }
    setBusy(false);
  }
  const showSetup = isAdmin && cfg && (!cfg.configured || editing);

  return (
    <PageShell user={user} active="Clinic Assistant" title="Clinic AI" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Leadership only</div><h1>Clinic AI</h1><p>Your clinic data analyst — patients, charts, revenue, reports.</p></div>
        {isAdmin && cfg?.configured && <button className="btn btn-ghost" onClick={() => setEditing((x) => !x)}>Change n8n link</button>}
      </div>
      {showSetup && (
        <div className="card">
          <b>Connect the n8n chat link (one time)</b>
          <p className="meta">In n8n open “Clinic AI Data Analyst”, click the first box “When chat message received”, copy the <b>Production URL</b>, paste it here. The workflow must be switched <b>Active</b>.</p>
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-n8n-address/webhook/…/chat" />
          {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={saveUrl}>Save link</button></div>
        </div>)}
      {cfg && !cfg.configured && !isAdmin && <div className="empty">Clinic AI is not connected yet. Ask the admin to connect it.</div>}
      {cfg?.configured && (
        <div className="card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 300px)", minHeight: 420 }}>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", whiteSpace: "pre-wrap", padding: "10px 14px", borderRadius: 14, background: m.role === "user" ? "var(--brand, #6d4aff)" : "var(--bg-soft, #f3efff)", color: m.role === "user" ? "#fff" : "inherit" }}>{m.content}</div>))}
            {busy && <div className="meta">Thinking… (data questions can take up to a minute)</div>}
            <div ref={bottom} />
          </div>
          {messages.length === 1 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>{IDEAS.map((q) => <button key={q} className="btn btn-outline btn-sm" onClick={() => send(q)}>{q}</button>)}</div>}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input className="field" style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about patients, revenue, charts…" />
            <button className="btn btn-primary" disabled={busy}>Send</button>
          </form>
        </div>)}
    </PageShell>
  );
}
