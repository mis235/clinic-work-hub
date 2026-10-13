import { useEffect, useRef, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import { AdvisorsBody } from "./AdvisorsPage.jsx";

const SOURCE_LABEL = { data: "Live data", policy: "Policy", ai: "AI", fallback: "", error: "" };

export default function AssistantPage({ user, isStaffLayout, onLogout, onBack }) {
  const [suggestions, setSuggestions] = useState([]);
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Hi ${user.name.split(" ")[0]}, I'm the Staff Assistant. Ask me about your tasks, attendance, or any clinic policy.` },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tab, setTab] = useState("help");
  const isLead = user.role === "admin" || user.role === "manager";
  const bottomRef = useRef(null);

  useEffect(() => {
    api.getAssistantFaqs().then((d) => setSuggestions(d.suggestions || [])).catch(() => setSuggestions([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    setBusy(true);
    try {
      const { reply, source } = await api.askAssistant(content);
      setMessages((m) => [...m, { role: "assistant", content: reply, source }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `Something went wrong: ${err.message}`, source: "error" }]);
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <div className="page-head">
        <h1>AI Assistant</h1>
        <p>{tab === "help" ? "Instant answers on tasks, attendance and policies." : "Specialist advisers for managers."}</p>
      </div>
      {isLead && (
        <div className="pill-row">
          <button className={`pill ${tab === "help" ? "active" : ""}`} onClick={() => setTab("help")}>Help assistant</button>
          <button className={`pill ${tab === "advisors" ? "active" : ""}`} onClick={() => setTab("advisors")}>Advisers</button>
        </div>
      )}
      {tab === "advisors" && isLead ? <AdvisorsBody intro={false} /> : <>

      <div className="chat-window">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            <div className="chat-bubble-content">{m.content}</div>
            {m.source && SOURCE_LABEL[m.source] && <div className="chat-bubble-tag">{SOURCE_LABEL[m.source]}</div>}
          </div>
        ))}
        {busy && (
          <div className="chat-bubble assistant">
            <div className="chat-bubble-content chat-typing"><span></span><span></span><span></span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {suggestions.length > 0 && (
        <div className="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} className="chat-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      <div className="chat-inputbar">
        <input
          className="field"
          placeholder="Ask the Staff Assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={busy}
        />
        <button className="btn btn-primary btn-brass" disabled={busy || !input.trim()} onClick={() => send()}>Send</button>
      </div>
      </>}
    </>
  );

  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{body}</div>;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Assistant"
        onSelect={(item) => item !== "Assistant" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main" style={{ maxWidth: 680 }}>
        <MobileTopBar title="Assistant" onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </div>
    </div>
  );
}
