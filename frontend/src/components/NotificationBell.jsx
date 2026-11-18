import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import { doll } from "./Doll.jsx";

const ago = (iso) => {
  const t = new Date(String(iso).replace(" ", "T") + "Z"), m = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} hr ago`;
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

// The bell, on every screen. The number is what you have not read yet; open it to see everything you missed.
export default function NotificationBell() {
  const [d, setD] = useState({ unread: 0, items: [] }), [open, setOpen] = useState(false), box = useRef(null);
  const seen = useRef(null);
  const load = () => api.inbox().then((r) => { if (!r) return; if (seen.current != null && r.unread > seen.current) doll("notify", 3000); seen.current = r.unread; setD(r); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  useEffect(() => { if (!open) return; const f = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, [open]);
  async function openItem(n) {
    if (!n.read) { api.readMessage(n.id).catch(() => {}); setD((x) => ({ unread: Math.max(0, x.unread - 1), items: x.items.map((i) => (i.id === n.id ? { ...i, read: true } : i)) })); }
    if (/^(help|dm):/.test(n.kind)) { setOpen(false); window.dispatchEvent(new CustomEvent("hub-goto", { detail: { view: "Help", kind: n.kind } })); }
  }
  async function readAll() { await api.readAllMessages().catch(() => {}); load(); }
  return (
    <div className="bell-wrap" ref={box}>
      <button className="bell-btn" onClick={() => { setOpen((o) => !o); load(); }} aria-label={`Notifications, ${d.unread} unread`}>
        <Icon name="bell" size={20} />{d.unread > 0 && <span className="bell-count">{d.unread > 99 ? "99+" : d.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head"><b>Notifications</b>{d.unread > 0 && <button className="bell-link" onClick={readAll}>Mark all as read</button>}</div>
          <div className="bell-list">
            {d.items.length === 0 && <div className="bell-empty">You are all caught up.</div>}
            {d.items.map((n) => (
              <button key={n.id} className={`bell-item ${n.read ? "" : "unread"}`} onClick={() => openItem(n)}>
                <span className="bell-dot" />
                <span className="bell-txt"><span className="bell-title">{n.title}</span><span className="bell-body">{n.body}</span><span className="bell-time">{ago(n.createdAt)}</span></span>
              </button>))}
          </div>
        </div>)}
    </div>
  );
}
