import { useEffect, useState } from "react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";

const f12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const dm = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

// Usual hours for every person (they decide who is late), changeable one by one or by pasting the clinic's list.
export function UsualHours({ flash }) {
  const [rows, setRows] = useState(null), [q, setQ] = useState(""), [paste, setPaste] = useState(""), [prev, setPrev] = useState(null);
  const load = () => api.shiftTimes().then((d) => setRows(d.rows)).catch((e) => flash(e.message));
  useEffect(() => { load(); }, []);
  async function save(r, start, end) {
    try { await api.saveShiftTime(r.id, start, end); flash("Saved."); load(); } catch (e) { flash(e.message); }
  }
  async function check(apply) {
    try { const d = await api.importShiftTimes(paste, apply); setPrev(d); if (apply) { flash("Shift times saved."); setPaste(""); load(); } } catch (e) { flash(e.message); }
  }
  const list = (rows || []).filter((r) => (r.name + r.department + r.designation).toLowerCase().includes(q.toLowerCase()));
  const groups = {}; list.forEach((r) => (groups[r.department || "Other"] = groups[r.department || "Other"] || []).push(r));
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="title" style={{ marginBottom: 6 }}>Paste shift list</div>
        <textarea className="field" rows={5} placeholder={"Jyothi – 10:00 AM to 6:30 PM\nKavya – 10:00 AM to 7:30 PM"} value={paste} onChange={(e) => { setPaste(e.target.value); setPrev(null); }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-outline btn-sm" disabled={!paste.trim()} onClick={() => check(false)}>Check</button>
          <button className="btn btn-primary btn-sm" disabled={!prev || prev.applied} onClick={() => check(true)}>Save</button>
        </div>
        {prev && <div style={{ marginTop: 10 }}>
          {prev.result.map((r, i) => <div key={i} className="task-row"><div className="title">{r.typed}{r.name && r.name !== r.typed ? ` → ${r.name}` : ""}</div><div className="meta" style={{ color: r.userId ? undefined : "#b91c1c" }}>{r.userId ? r.label : "Not in staff list. Add this person first."}</div></div>)}
        </div>}
      </div>
      <input className="field" placeholder="Search staff" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {!rows ? <div className="empty">Loading…</div> : Object.entries(groups).map(([dep, rs]) => (
        <div key={dep} className="card" style={{ marginBottom: 12 }}>
          <div className="title" style={{ marginBottom: 6 }}>{dep}</div>
          {rs.map((r) => (
            <div key={r.id} className="task-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <div className="rt-people" style={{ flex: 1, minWidth: 170 }}><Avatar id={r.id} name={r.name} hasPhoto={r.hasPhoto} size={34} /><div><div className="title">{r.name}</div><div className="meta">{r.designation}</div></div></div>
              <input className="field" type="time" style={{ width: 118 }} defaultValue={r.start} key={r.id + r.start} id={"s" + r.id} />
              <span className="meta">to</span>
              <input className="field" type="time" style={{ width: 118 }} defaultValue={r.end} key={r.id + r.end} id={"e" + r.id} />
              <button className="btn btn-primary btn-sm" onClick={() => save(r, document.getElementById("s" + r.id).value, document.getElementById("e" + r.id).value)}>Save</button>
              {r.start && <button className="btn btn-ghost btn-sm" onClick={() => save(r, "", "")}>Clear</button>}
            </div>))}
        </div>))}
    </>
  );
}

// Doctors' rota: date ranges, a 10:00 / 10:30 slot per doctor.
export function DoctorRota({ flash }) {
  const [d, setD] = useState(null), [f, setF] = useState({ from: "", to: "", userId: "", start: "10:00" });
  const load = () => api.doctorRota().then(setD).catch((e) => flash(e.message));
  useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault();
    try { await api.addDoctorRota(f); flash("Added."); setF({ ...f, userId: "" }); load(); } catch (er) { flash(er.message); }
  }
  async function del(id) { try { await api.delDoctorRota(id); load(); } catch (er) { flash(er.message); } }
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <>
      <form className="card" onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input className="field" type="date" style={{ width: 150 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required />
        <span className="meta">to</span>
        <input className="field" type="date" style={{ width: 150 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required />
        <select className="field" style={{ width: 170 }} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
          <option value="">Doctor…</option>{d.doctors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input className="field" type="time" style={{ width: 120 }} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required />
        <button className="btn btn-primary btn-sm" type="submit">Add</button>
      </form>
      {!d.blocks.length && <div className="empty">No rota yet.</div>}
      {d.blocks.map((b) => (
        <div key={b.from + b.to} className={"rota-block" + (d.today >= b.from && d.today <= b.to ? " now" : "")}>
          <div className="title">{dm(b.from)} – {dm(b.to)}{d.today >= b.from && d.today <= b.to ? "  ·  Now" : ""}</div>
          {Object.keys(b.slots).sort().map((t) => (
            <div key={t} className="rota-slot"><span className="t">{f12(t)}</span>
              {b.slots[t].map((x) => <span key={x.id} className="rota-chip">{x.name}<button title="Remove" onClick={() => del(x.id)}>✕</button></span>)}
            </div>))}
        </div>))}
    </>
  );
}
