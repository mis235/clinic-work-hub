import { useEffect, useState } from "react";
import { api } from "../api.js";

// Admin overview: which procedure rooms are free or in use right now, plus today's count.
export default function RoomsCard({ onNavigate }) {
  const [d, setD] = useState(null);
  useEffect(() => { const load = () => api.listRooms().then(setD).catch(() => {}); load(); const t = setInterval(load, 15000); window.addEventListener("hub-refresh", load); return () => { window.removeEventListener("hub-refresh", load); clearInterval(t); }; }, []);
  if (!d) return null;
  const busy = d.rooms.filter((r) => r.current).length;
  return (
    <div className="card" style={{ margin: "16px 0" }}>
      <div className="section-head">
        <div><h2>Procedure Rooms</h2><div className="sub">{busy} of {d.rooms.length} in use · {d.sessions.length} patient{d.sessions.length === 1 ? "" : "s"} today</div></div>
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("Procedure Rooms")}>Open</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10 }}>
        {d.rooms.map((r) => (
          <div key={r.key} style={{ borderLeft: `4px solid ${r.current ? "#dc2626" : "#16a34a"}`, background: "var(--bg-soft, #f6f7f9)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
            <b>{r.floor} · {r.name}</b>
            <div>{r.current ? <>{r.current.patient}<div className="muted" style={{ fontSize: 12 }}>{r.current.procedure} · in {r.current.checkIn}</div></> : <span className="muted">Free</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
