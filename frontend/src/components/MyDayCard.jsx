import { useEffect, useState } from "react";
import { api } from "../api.js";

// Staff home: my work at a glance (no attendance or fines are shown to staff).
export default function MyDayCard({ onNavigate }) {
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.portalMe().then(setMe).catch(() => {});
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
        {tile("Work completed (30 days)", me.completion_pct == null ? "—" : me.completion_pct + "%", "shiftchecklist")}
        {tile("My work documents", me.my_documents, "documents")}
      </div>
    </>
  );
}
