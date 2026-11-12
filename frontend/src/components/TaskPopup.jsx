import { useEffect, useState } from "react";
import { api } from "../api.js";

// Pops up when new tasks have been given to this person (shown once, then marked as seen).
export default function TaskPopup({ onOpen }) {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    const load = () => api.unseenTasks().then((t) => setTasks((old) => (Array.isArray(t) && t.length ? t : old.length ? old : []))).catch(() => {});
    load(); const id = setInterval(load, 30000); return () => clearInterval(id);
  }, []);
  if (!tasks.length) return null;
  const close = (open) => { api.markTasksSeen().catch(() => {}); setTasks([]); if (open && onOpen) onOpen(); };
  return (
    <div role="dialog" style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, width: "min(460px,100%)", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>🔔 {tasks.length === 1 ? "New Task For You" : `${tasks.length} New Tasks For You`}</div>
        {tasks.map((t) => (
          <div key={t.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ fontWeight: 600 }}>{t.title}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t.category}{t.due_date ? ` · due ${new Date(t.due_date).toLocaleString()}` : ""}</div>
            {t.notes && <div style={{ fontSize: 13, marginTop: 4 }}>{t.notes}</div>}
          </div>
        ))}
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button className="btn btn-light btn-sm" onClick={() => close(false)}>OK</button>{" "}
          <button className="btn btn-primary btn-sm" onClick={() => close(true)}>Open My Tasks</button>
        </div>
      </div>
    </div>
  );
}
