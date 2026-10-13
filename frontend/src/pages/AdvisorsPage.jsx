import { useEffect, useState, useRef } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export function AdvisorsBody({ intro = true }) {
  const [advisors, setAdvisors] = useState(null);
  const [active, setActive] = useState(null);
  useEffect(() => { api.listAdvisors().then(setAdvisors).catch(() => setAdvisors([])); }, []);
  return active ? (
    <AdvisorChat advisor={active} onBack={() => setActive(null)} />
  ) : (
    <>
      {intro && <p className="meta">Specialist advisers for staffing and workforce questions. Advice only, nothing changes automatically.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
        {advisors === null && <div className="empty">Loading…</div>}
        {advisors?.map((a) => (
          <button key={a.id} onClick={() => setActive(a)} style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, cursor: "pointer" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.5 }}>{a.mission}</div>
          </button>
        ))}
      </div>
    </>
  );
}

export default function AdvisorsPage({ user, onLogout, onBack }) {
  const [advisors, setAdvisors] = useState(null);
  const [active, setActive] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    api.listAdvisors().then(setAdvisors).catch(() => setAdvisors([]));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        items={navItemsFor(user)}
        active="AI Advisors"
        onSelect={(item) => item !== "AI Advisors" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`}
        onLogout={onLogout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="main">
        <MobileTopBar title="AI Advisors" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head">
          <h1>AI Advisors</h1>
          <p>Specialist agents for workforce and staffing questions — advisory only, nothing here changes records automatically.</p>
        </div>

        {active ? (
          <AdvisorChat advisor={active} onBack={() => setActive(null)} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 20 }}>
            {advisors === null && <div className="empty">Loading advisors…</div>}
            {advisors?.map((a) => (
              <button
                key={a.id}
                onClick={() => setActive(a)}
                style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.5 }}>{a.mission}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdvisorChat({ advisor, onBack }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    setError("");
    const next = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { reply } = await api.chatWithAdvisor(advisor.id, next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>← All advisors</button>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-head"><span className="name">{advisor.name}</span></div>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "0 0 14px" }}>{advisor.mission}</p>

        <div style={{ minHeight: 200, maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              Ask a question — e.g. "Are we understaffed at Front Desk given our current volume?" Give it real numbers where you can; it'll ask if something critical is missing.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "var(--navy)" : "var(--surface-sunk)",
              color: m.role === "user" ? "#fff" : "var(--ink)",
              padding: "10px 14px", borderRadius: 12, maxWidth: "85%", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.5,
            }}>
              {m.content}
            </div>
          ))}
          {busy && <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Thinking…</div>}
          <div ref={bottomRef} />
        </div>

        {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            placeholder="Type your question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn btn-primary" style={{ width: "auto" }} onClick={send} disabled={busy}>Send</button>
        </div>
      </div>
    </div>
  );
}
