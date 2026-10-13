import { useEffect, useState } from "react";
import { api } from "../api.js";

const CATS = [
  { key: "late", label: "Late arrival", amount: 100 },
  { key: "dress_code", label: "Dress code", amount: 200 },
  { key: "misbehaviour", label: "Misbehaviour", amount: 500 },
  { key: "absent", label: "Absent without notice", amount: 500 },
  { key: "other", label: "Other", amount: 0 },
];
export const catLabel = (k) => CATS.find((c) => c.key === k)?.label || k;
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);

// Admin / manager: add a fine (late, dress code, misbehaviour...) and see this month's list. Fines come off the payslip automatically.
export default function FinesPanel({ month, isAdmin, preset, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ userId: "", category: "late", amount: 100, date: todayIST(), note: "" });
  const [msg, setMsg] = useState("");
  const load = () => {
    api.finesSummary(month).then(setSummary).catch(() => setSummary({ rows: [], total: 0 }));
    api.fines(month).then((d) => setList(d.rows)).catch(() => setList([]));
  };
  useEffect(load, [month]);
  useEffect(() => { if (preset) setForm((f) => ({ ...f, ...preset })); }, [preset]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function pickCat(key) { set("category", key); const c = CATS.find((x) => x.key === key); if (c?.amount) set("amount", c.amount); }
  async function save(e) {
    e.preventDefault();
    try {
      await api.addFine({ ...form, amount: Number(form.amount) });
      setMsg("Fine added. It will be deducted in this month's payslip."); setForm((f) => ({ ...f, note: "" })); load(); onChanged?.();
    } catch (err) { setMsg(err.message); }
    setTimeout(() => setMsg(""), 4000);
  }
  async function remove(id) {
    if (!confirm("Remove this fine?")) return;
    try { await api.deleteFine(id); load(); onChanged?.(); } catch (err) { setMsg(err.message); }
  }

  return (
    <>
      <form className="card" onSubmit={save} style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div className="title">Add a fine</div>
        <select className="field" required value={form.userId} onChange={(e) => set("userId", e.target.value)}>
          <option value="">Choose staff member…</option>
          {(summary?.rows || []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.department ? ` — ${r.department}` : ""}</option>)}
        </select>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <select className="field" value={form.category} onChange={(e) => pickCat(e.target.value)}>
            {CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input className="field" type="number" min="1" required placeholder="Amount ₹" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          <input className="field" type="date" max={todayIST()} value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <input className="field" placeholder="Note (e.g. came at 10:40, no ID card)" value={form.note} onChange={(e) => set("note", e.target.value)} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="meta">{msg}</span>
          <button className="btn btn-primary" type="submit">Add fine</button>
        </div>
      </form>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <div className="title">Fines in {month}</div>
          <span className="badge overdue">Total {rupee(summary?.total)}</span>
        </div>
        {list.length === 0 && <div className="empty">No fines this month.</div>}
        {list.map((f) => (
          <div key={f.id} className="task-row">
            <div>
              <div className="title">{f.staff_name} · {catLabel(f.category)}</div>
              <div className="meta">{f.fine_date}{f.department ? ` · ${f.department}` : ""}{f.note ? ` · ${f.note}` : ""}{f.added_by_name ? ` · by ${f.added_by_name}` : ""}</div>
            </div>
            <div className="right" style={{ gap: 8 }}>
              <span className="badge overdue">{rupee(f.amount)}</span>
              {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => remove(f.id)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
