import { useEffect, useState } from "react";
import { api } from "../api.js";

// A kind note from the clinic (leaving early, staying late...). Shows once and goes away when read.
export default function NoteBanner() {
  const [notes, setNotes] = useState([]);
  useEffect(() => { api.myMessages().then((n) => setNotes(Array.isArray(n) ? n : [])).catch(() => {}); }, []);
  if (!notes.length) return null;
  const n = notes[0];
  const close = () => { api.readMessage(n.id).catch(() => {}); setNotes((x) => x.slice(1)); };
  return (
    <div role="status" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 300, width: "min(560px, calc(100% - 24px))", background: "#fff", border: "1px solid var(--line)", borderLeft: "5px solid var(--primary)", borderRadius: 14, boxShadow: "0 10px 30px rgba(0,0,0,.15)", padding: "14px 16px" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>💬 {n.title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{n.body}</div>
      <div style={{ textAlign: "right", marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={close}>Thank You</button></div>
    </div>
  );
}
