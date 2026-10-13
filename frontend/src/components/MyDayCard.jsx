import { useEffect, useState } from "react";
import { api } from "../api.js";
import { catLabel } from "./FinesPanel.jsx";

const fmtTime = (t) => (t ? new Date(t.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Staff home: "my day" at a glance, plus my own fines for the month (so nothing is a surprise on payday).
export default function MyDayCard({ onNavigate }) {
  const [me, setMe] = useState(null);
  const [fines, setFines] = useState([]);
  useEffect(() => {
    api.portalMe().then(setMe).catch(() => {});
    api.fines().then((d) => setFines(d.rows)).catch(() => {});
  }, []);
  if (!me) return null;
  const tile = (label, value, go) => (
    <button className="dept-card" onClick={() => go && onNavigate?.(go)} style={{ cursor: go ? "pointer" : "default" }}>
      <div className="meta">{label}</div><div className="title" style={{ fontSize: 22 }}>{value}</div>
    </button>
  );
  return (
    <>
      <div className="dept-grid tile-grid" style={{ marginTop: 16 }}>
        {tile("Attendance today", me.checked_in ? `In at ${fmtTime(me.first_in)}` : "Not in yet")}
        {tile("Days present this month", me.days_present)}
        {tile("Work completed (30 days)", me.completion_pct == null ? "—" : me.completion_pct + "%", "shiftchecklist")}
        {tile("My work documents", me.my_documents, "documents")}
        {tile("Fines this month", rupee(me.fines_month))}
      </div>
      {fines.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="title" style={{ marginBottom: 6 }}>My fines this month</div>
          {fines.map((f) => (
            <div key={f.id} className="task-row">
              <div><div className="title">{catLabel(f.category)}</div><div className="meta">{f.fine_date}{f.note ? ` · ${f.note}` : ""}</div></div>
              <span className="badge overdue">{rupee(f.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
