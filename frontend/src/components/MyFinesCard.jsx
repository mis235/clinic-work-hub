import { useEffect, useState } from "react";
import { api } from "../api.js";

// Staff see their own fines (this month and the last two), so a fine is never a surprise on payday.
export default function MyFinesCard() {
  const [d, setD] = useState(null);
  useEffect(() => { const load = () => api.myFines().then(setD).catch(() => {}); load(); window.addEventListener("hub-refresh", load); const t = setInterval(load, 60000); return () => { clearInterval(t); window.removeEventListener("hub-refresh", load); }; }, []);
  if (!d || d.rows.length === 0) return null;
  return (
    <div className="card" style={{ borderLeft: "4px solid #dc2626" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <b>My Fines</b><span className="meta">This month: <b style={{ color: "#b91c1c" }}>₹{d.thisMonth}</b></span>
      </div>
      <div style={{ marginTop: 8 }}>
        {d.rows.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
            <div><b>{r.reason}</b>{r.note ? <div className="meta">{r.note}</div> : null}</div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}><b>₹{r.amount}</b><div className="meta">{new Date(r.fine_date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</div></div>
          </div>))}
      </div>
    </div>
  );
}
