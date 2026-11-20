import { useEffect, useState } from "react";
import { api } from "../api.js";

// A person's own offer letters: download any time.
export default function MyOfferLetters() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.myOfferLetters().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div className="name">My offer letter</div></div>
      {rows.length === 0 && <div className="meta">No offer letter yet.</div>}
      {rows.map((g) => (
        <div key={g.id} className="task-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}><div className="title">{g.file_name?.replace(/\.docx$/i, "") || "Offer letter"}</div>
            <div className="meta">{new Date(g.created_at.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div></div>
          <button className="btn btn-outline btn-sm" onClick={() => api.downloadMyOfferLetter(g.id, g.file_name || "Offer letter.docx")}>Download</button>
        </div>))}
    </div>
  );
}
