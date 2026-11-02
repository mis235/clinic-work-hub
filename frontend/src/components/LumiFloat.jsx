import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Lumi from "./Lumi.jsx";

// Lumi in the corner of every screen: tap her to ask about your tasks, leave, attendance rules or clinic policies.
export default function LumiFloat({ user }) {
  const first = (user.name || "").split(/\s+/).find((w) => !/^dr\.?$/i.test(w)) || "there";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `Hi ${first}, I am Lumi. Ask me about your tasks, leave or any clinic policy.` }]);
  const end = useRef(null);
  useEffect(() => { if (open && !ideas.length) api.getAssistantFaqs().then((d) => setIdeas((d.suggestions || []).slice(0, 3))).catch(() => {}); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, open]);

  async function send(t) {
    const q = (t ?? input).trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: "user", content: q }]); setInput(""); setBusy(true);
    try { const { reply } = await api.askAssistant(q); setMsgs((m) => [...m, { role: "assistant", content: reply }]); }
    catch (e) { setMsgs((m) => [...m, { role: "assistant", content: "Sorry, something went wrong: " + e.message }]); }
    setBusy(false);
  }
  return (
    <>
      {open && (
        <div className="lumi-panel" role="dialog" aria-label="Lumi">
          <div className="lumi-panel-head">
            <Lumi mood={busy ? "think" : "wave"} size={40} />
            <div><b>Lumi</b><div className="meta">Your clinic helper</div></div>
            <button className="lumi-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="lumi-msgs">
            {msgs.map((m, i) => <div key={i} className={`lumi-msg ${m.role}`}>{m.content}</div>)}
            {busy && <div className="lumi-msg assistant">Thinking…</div>}
            {msgs.length === 1 && ideas.length > 0 && <div className="lumi-ideas">{ideas.map((q) => <button key={q} className="pill" onClick={() => send(q)}>{q}</button>)}</div>}
            <div ref={end} />
          </div>
          <form className="lumi-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Lumi…" />
            <button className="btn btn-primary btn-sm" disabled={busy}>Send</button>
          </form>
        </div>
      )}
      <button className="lumi-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close Lumi" : "Ask Lumi"}>
        <Lumi mood={open ? "idle" : "wave"} size={62} />
      </button>
    </>
  );
}
