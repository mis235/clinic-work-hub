import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import Doll, { doll } from "./Doll.jsx";

const ago = (iso) => {
  const t = new Date(String(iso).replace(" ", "T") + "Z"), m = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} hr ago`;
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

// The bell, on every screen. The number is what you have not read yet; open it to see everything you missed.
export default function NotificationBell() {
  const [d, setD] = useState({ unread: 0, items: [] }), [open, setOpen] = useState(false), [tab, setTab] = useState("all"), [pos, setPos] = useState({ top: 70, right: 16 }), box = useRef(null), panel = useRef(null), btn = useRef(null);
  const seen = useRef(null);
  const load = () => api.inbox().then((r) => { if (!r) return; if (seen.current != null && r.unread > seen.current) doll("notify", 3000); seen.current = r.unread; setD(r); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); window.addEventListener("hub-refresh", load); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  useEffect(() => { if (!open) return; const f = (e) => { if (!box.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, [open]);
  async function openItem(n) {
    if (!n.read) { api.readMessage(n.id).catch(() => {}); setD((x) => ({ unread: Math.max(0, x.unread - 1), items: x.items.map((i) => (i.id === n.id ? { ...i, read: true } : i)) })); }
    if (/^(help|dm):/.test(n.kind)) { setOpen(false); window.dispatchEvent(new CustomEvent("hub-goto", { detail: { view: "Help", kind: n.kind } })); }
  }
  async function readAll() { await api.readAllMessages().catch(() => {}); load(); }
  const place = () => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ top: Math.round(r.bottom + 10), right: Math.max(12, Math.round(window.innerWidth - r.right)) }); };
  useEffect(() => { if (!open) return; place(); window.addEventListener("resize", place); return () => window.removeEventListener("resize", place); }, [open]);
  const shown = tab === "unread" ? d.items.filter((n) => !n.read) : d.items;
  return (
    <div className="bell-wrap" ref={box}>
      <button ref={btn} className="bell-btn" onClick={() => { setOpen((o) => !o); load(); }} aria-label={`Notifications, ${d.unread} unread`}>
        <Icon name="bell" size={20} />{d.unread > 0 && <span className="bell-count">{d.unread > 99 ? "99+" : d.unread}</span>}
      </button>
      {open && createPortal(
        <div className="bell-panel" ref={panel} style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <b>Notifications{d.unread > 0 && <span className="bell-badge">{d.unread} new</span>}</b>
            <button className="bell-readall" onClick={readAll} disabled={d.unread === 0}><Icon name="check" size={14} /> Mark all as read</button>
          </div>
          <div className="bell-tabs">
            <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All</button>
            <button className={tab === "unread" ? "on" : ""} onClick={() => setTab("unread")}>Unread</button>
          </div>
          <div className="bell-list">
            {shown.length === 0 && <div className="bell-empty"><Doll mood="happy" size={110} follow={false} />{tab === "unread" ? "No unread notifications." : "You are all caught up."}</div>}
            {shown.map((n) => (
              <button key={n.id} className={`bell-item ${n.read ? "" : "unread"}`} onClick={() => openItem(n)}>
                <span className="bell-dot" />
                <span className="bell-txt"><span className="bell-title">{n.title}</span><span className="bell-body">{n.body}</span><span className="bell-time">{ago(n.createdAt)}</span></span>
              </button>))}
          </div>
        </div>, document.body)}
    </div>
  );
}
