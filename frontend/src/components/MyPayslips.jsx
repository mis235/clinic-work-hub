import { useEffect, useState } from "react";
import { api } from "../api.js";

// A person's own payslips: open the PDF any time.
export default function MyPayslips() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.listPayslips().then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return null;
  const mine = rows.slice(0, 6);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div className="name">My payslips</div></div>
      {mine.length === 0 && <div className="meta">No payslip yet.</div>}
      {mine.map((s) => (
        <div key={s.id} className="task-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}><div className="title">{new Date(s.pay_period + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
            <div className="meta">Net ₹{Math.round(s.net_payable).toLocaleString("en-IN")}</div></div>
          <button className="btn btn-outline btn-sm" onClick={() => api.openPayslip(s.id)}>View PDF</button>
        </div>))}
    </div>
  );
}
