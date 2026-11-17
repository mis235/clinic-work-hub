import { useEffect, useMemo, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api, downloadFile } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const istMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);
const shiftMonth = (m, n) => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
const nice = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const TONE = { ok: "good", late: "warn", no_uniform: "bad", grooming: "bad", half_day: "warn", absent: "bad", off: "mute" };

// Grooming book, laid out like the paper register: names down the side, days across, Morning and Afternoon for each day.
export default function GroomingPage({ user, onLogout, onBack, isStaffLayout }) {
  const [month, setMonth] = useState(istMonth()), [d, setD] = useState(null), [date, setDate] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("day"), [pick, setPick] = useState([]), [mobileOpen, setMobileOpen] = useState(false);
  const load = () => api.groomingBook(month).then((x) => { setD(x); setPick(x.assignees.map((a) => a.id)); setDate((cur) => (cur && cur.startsWith(month) ? cur : month === istMonth() ? x.today : `${month}-01`)); }).catch((e) => setMsg(e.message));
  useEffect(() => { setD(null); load(); }, [month]);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  async function mark(userId, session, code) {
    const cur = d.marks[userId]?.[date]?.[session]?.code;
    const next = cur === code ? "" : code;
    setD((x) => { const m = structuredClone(x.marks); ((m[userId] ||= {})[date] ||= {}); if (next) m[userId][date][session] = { code: next, note: "" }; else delete m[userId][date][session]; return { ...x, marks: m }; });
    try { await api.groomingMark({ userId, date, session, code: next }); } catch (e) { flash(e.message); load(); }
  }
  async function saveAssign() { setBusy(true); try { await api.groomingAssign({ month, userIds: pick }); flash("Saved. The chosen people can now mark the grooming book for this month."); load(); } catch (e) { flash(e.message); } setBusy(false); }

  const codes = d?.codes || [], short = (k) => codes.find((c) => c.key === k)?.short || "", label = (k) => codes.find((c) => c.key === k)?.label || "";
  const dayText = useMemo(() => {
    if (!d || !date) return "";
    const bad = [], ok = [];
    d.staff.forEach((p) => { const m = d.marks[p.id]?.[date] || {}; const parts = ["AM", "PM"].filter((s) => m[s] && m[s].code !== "ok").map((s) => `${s === "AM" ? "Morning" : "Afternoon"}: ${label(m[s].code)}`); if (parts.length) bad.push(`• ${p.name} — ${parts.join(", ")}`); else if (m.AM || m.PM) ok.push(p.name); });
    return `Grooming report — ${nice(date)}\n\n${bad.length ? "Needs attention:\n" + bad.join("\n") : "Everyone marked is neat today."}${ok.length ? `\n\nNeat (${ok.length}): ${ok.join(", ")}` : ""}\n\n— Dr. Nishita's Clinic`;
  }, [d, date]);

  const days = d ? Array.from({ length: d.days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`) : [];
  const body = (
    <>
      <div className="page-head row">
        <div><div className="eyebrow">Daily Work</div><h1>Grooming Book</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-sm" onClick={() => downloadFile(`/api/grooming/export?month=${month}`, `grooming-${month}.xlsx`).catch((e) => flash(e.message))}>⬇ Download Excel</button>
          <a className="btn btn-primary btn-sm" href={`https://wa.me/?text=${encodeURIComponent(dayText)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
      </div>
      <div className="month-bar">
        <button className="btn btn-outline btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
        <div className="month-name">{new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
        <button className="btn btn-outline btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
      </div>
      {msg && <div className="note" style={{ marginBottom: 10 }}>{msg}</div>}
      {!d ? <div className="empty">Loading…</div> : (<>
        <div className="card groom-who">
          <div className="card-head"><div className="name">Grooming inspectors this month</div></div>
          {d.assignees.length === 0 ? <div className="meta">No one is assigned yet.</div> : <div className="chips">{d.assignees.map((a) => <span key={a.id} className="chip">{a.name}{d.canAssign && <button type="button" title="Remove access" aria-label={`Remove ${a.name}`} style={{ border: 0, background: "none", cursor: "pointer", marginLeft: 6, color: "#b91c1c", fontWeight: 700 }} onClick={async () => { if (!confirm(`Remove ${a.name} as grooming inspector?`)) return; try { await api.groomingAssign({ month, userIds: d.assignees.filter((x) => x.id !== a.id).map((x) => x.id) }); load(); } catch (e) { flash(e.message); } }}>✕</button>}</span>)}</div>}
          {d.canAssign && (
            <details style={{ marginTop: 10 }}>
              <summary className="btn btn-ghost btn-sm" style={{ display: "inline-flex" }}>Change inspectors</summary>
              <div className="groom-pick">{d.staff.map((p) => (
                <label key={p.id} className="ms-row"><input type="checkbox" checked={pick.includes(p.id)} onChange={() => setPick(pick.includes(p.id) ? pick.filter((x) => x !== p.id) : [...pick, p.id])} /> {p.name}</label>))}</div>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveAssign}>{busy ? "Saving…" : "Save inspectors"}</button>
            </details>)}
          {!d.canMark && <div className="meta" style={{ marginTop: 8 }}>Only the inspectors above can mark the book.</div>}
        </div>

        <div className="pill-row">
          <button className={`pill ${tab === "day" ? "active" : ""}`} onClick={() => setTab("day")}>Mark a day</button>
          <button className={`pill ${tab === "book" ? "active" : ""}`} onClick={() => setTab("book")}>Month book</button>
        </div>

        {tab === "day" && (
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <div><div className="title">{nice(date)}</div><div className="meta">{d.canMark ? `Tap Morning and Afternoon for each person. “No uniform” or “Grooming issue” adds a ₹${d.fine} fine to the payslip, once a day.` : "View only"}</div></div>
              <input className="field" type="date" style={{ width: 170 }} value={date} min={`${month}-01`} max={d.today < `${month}-31` ? d.today : `${month}-31`} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="groom-list">
              {d.staff.map((p, i) => {
                const m = d.marks[p.id]?.[date] || {};
                return (
                  <div key={p.id} className="groom-row">
                    <div className="groom-name"><span className="groom-sr">{i + 1}</span>{p.name}</div>
                    {["AM", "PM"].map((s) => (
                      <div key={s} className="groom-sess">
                        <span className="groom-sess-l">{s === "AM" ? "Morning" : "Afternoon"}</span>
                        <div className="groom-chips">{codes.map((c) => (
                          <button key={c.key} type="button" disabled={!d.canMark || p.id === user.id && user.role !== "admin"} className={`gchip ${TONE[c.key]} ${m[s]?.code === c.key ? "on" : ""}`} title={c.label} onClick={() => mark(p.id, s, c.key)}>{c.short}</button>))}</div>
                      </div>))}
                  </div>);
              })}
            </div>
            <div className="legend-line">{codes.map((c) => <span key={c.key}><b>{c.short}</b> {c.label}</span>)}</div>
          </div>)}

        {tab === "book" && (
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="groom-book">
              <thead>
                <tr><th rowSpan={2}>Sr</th><th rowSpan={2} className="nm">Name</th>{days.map((dt) => <th key={dt} colSpan={2} className={dt === d.today ? "today" : ""}>{Number(dt.slice(8))}</th>)}</tr>
                <tr>{days.map((dt) => <><th key={dt + "a"} className="s">Am</th><th key={dt + "p"} className="s">Pm</th></>)}</tr>
              </thead>
              <tbody>
                {d.staff.map((p, i) => (
                  <tr key={p.id}><td>{i + 1}</td><td className="nm">{p.name}</td>
                    {days.map((dt) => ["AM", "PM"].map((s) => { const c = d.marks[p.id]?.[dt]?.[s]?.code; return <td key={dt + s} className={`g ${c ? TONE[c] : ""}`} onClick={() => { setDate(dt); setTab("day"); }}>{c ? short(c) : ""}</td>; }))}
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      </>)}
    </>
  );
  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{body}</div>;
  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Grooming" onSelect={(i) => i !== "Grooming" && onBack(i)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main"><MobileTopBar title="Grooming Book" onOpenMenu={() => setMobileOpen(true)} />{body}</div>
    </div>);
}
