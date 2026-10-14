import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const range = (r) => (r.from_date === r.to_date ? dmy(r.from_date) : `${dmy(r.from_date)} – ${dmy(r.to_date)}`);
const STATUS = { pending: ["Waiting for HR", "in_progress"], approved: ["Approved", "done"], rejected: ["Not approved", "overdue"], cancelled: ["Cancelled", ""] };

export default function LeavePage({ user, onLogout, onBack, isStaffLayout }) {
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("mine");
  useEffect(() => { api.leaveConfig().then(setCfg).catch(() => setCfg({ isHr: false, reasons: [], settings: {} })); }, []);
  if (!cfg) return <PageShell user={user} active="Leave" title="Leave & HR" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}><div className="empty">Loading…</div></PageShell>;
  const tabs = [["mine", "My leave"], ...(cfg.isHr ? [["approve", "Approvals"], ["all", "All requests"], ["late", "Late & fines"], ["bday", "Birthdays"], ["rules", "HR rules"]] : [])];
  return (
    <PageShell user={user} active="Leave" title="Leave & HR" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head"><div className="eyebrow">People</div><h1>Leave &amp; HR</h1><p>Apply for leave, see your balance, and (for HR) approve requests, late arrivals and birthdays.</p></div>
      {tabs.length > 1 && <div className="pills" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>{tabs.map(([k, l]) => <button key={k} className={`pill ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === "mine" && <Mine cfg={cfg} />}
      {tab === "approve" && <Requests cfg={cfg} status="pending" />}
      {tab === "all" && <Requests cfg={cfg} />}
      {tab === "late" && <Late />}
      {tab === "bday" && <Birthdays />}
      {tab === "rules" && <Rules cfg={cfg} onSaved={(s) => setCfg({ ...cfg, settings: s })} />}
    </PageShell>
  );
}

function Mine({ cfg }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ fromDate: todayIST(), toDate: todayIST(), halfDay: false, reasonType: "sick", reason: "" });
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.myLeave().then(setD).catch((e) => setMsg({ ok: false, t: e.message }));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const days = f.halfDay ? 0.5 : Math.max(1, Math.round((new Date(f.toDate) - new Date(f.fromDate)) / 86400000) + 1);
  async function apply() {
    setBusy(true); setMsg(null);
    try { const r = await api.applyLeave(f); setMsg({ ok: true, t: "Sent to HR. " + (r.warning || "You will see the answer here and on your home screen.") }); setF({ ...f, reason: "" }); load(); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  }
  async function cancel(id) { try { await api.cancelLeave(id); load(); } catch (e) { setMsg({ ok: false, t: e.message }); } }
  const s = d?.summary;
  return (
    <>
      {s && (
        <div className="dept-grid tile-grid">
          <div className="dept-card"><div className="meta">Free leave this month</div><div className="title" style={{ fontSize: 26 }}>{s.freeLeft} <span className="meta">of {s.allowed}</span></div></div>
          <div className="dept-card"><div className="meta">Taken (approved)</div><div className="title" style={{ fontSize: 26 }}>{s.taken}</div></div>
          <div className="dept-card"><div className="meta">Waiting for approval</div><div className="title" style={{ fontSize: 26 }}>{s.pending}</div></div>
          <div className="dept-card"><div className="meta">Unpaid days (salary cut)</div><div className="title" style={{ fontSize: 26, color: s.lopDays ? "var(--red)" : undefined }}>{s.lopDays}</div></div>
        </div>
      )}
      <div className="card">
        <div className="title" style={{ marginBottom: 4 }}>Apply for leave</div>
        <p className="meta" style={{ marginTop: 0 }}>Only casual leave. You get {cfg.settings.casual_per_month} free day{cfg.settings.casual_per_month === 1 ? "" : "s"} a month — each extra day cuts one day's salary. It is shown on your payslip.</p>
        <div className="form-grid">
          <div><label className="field-label">From</label><input className="field" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></div>
          <div><label className="field-label">To</label><input className="field" type="date" min={f.fromDate} value={f.toDate} onChange={set("toDate")} disabled={f.halfDay} /></div>
          <div><label className="field-label">Reason</label>
            <select className="field" value={f.reasonType} onChange={set("reasonType")}>{cfg.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
        </div>
        <label className="field-label" style={{ marginTop: 10 }}>Details {f.reasonType === "other" ? "(required)" : "(optional)"}</label>
        <input className="field" value={f.reason} onChange={set("reason")} placeholder="e.g. fever, doctor visit / travelling to hometown" />
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}><input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked, toDate: f.fromDate })} /> Half day only</label>
        {s && s.taken + s.pending + days > s.allowed && <div className="note" style={{ marginTop: 10 }}>⚠ This will use more than your {s.allowed} free day{s.allowed === 1 ? "" : "s"}. Extra days are unpaid.</div>}
        {msg && <div className={msg.ok ? "note" : "login-error"} style={{ marginTop: 10 }}>{msg.t}</div>}
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={apply}>{busy ? "Sending…" : `Send to HR (${days} day${days === 1 ? "" : "s"})`}</button>
      </div>
      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>My requests</div>
        {d && d.requests.length === 0 && <div className="empty">No requests yet.</div>}
        {d?.requests.map((r) => (
          <div key={r.id} className="task-row">
            <div><div className="title">{range(r)} · {r.days} day{r.days === 1 ? "" : "s"}</div>
              <div className="meta">{cfg.reasons.find((x) => x.key === r.reason_type)?.label}{r.reason ? ` — ${r.reason}` : ""}{r.hr_note ? ` · HR: ${r.hr_note}` : ""}{r.mgmt_ok ? ` · approved by ${r.mgmt_ok}` : ""}</div></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              {r.status === "pending" && <button className="btn btn-ghost btn-sm" onClick={() => cancel(r.id)}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Requests({ cfg, status }) {
  const [rows, setRows] = useState(null); const [msg, setMsg] = useState(null);
  const [ask, setAsk] = useState(null); // { id, decision }
  const [ok, setOk] = useState("Sir & Mam"); const [note, setNote] = useState("");
  const load = () => api.leaveRequests(status).then(setRows).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [status]);
  async function decide() {
    try { await api.decideLeave(ask.id, { decision: ask.decision, mgmtOk: ok, note }); setAsk(null); setNote(""); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <>
      {msg && <div className="login-error">{msg}</div>}
      {status === "pending" && <div className="meta" style={{ marginBottom: 10 }}>Take Sir's / Mam's OK first, then press Approve and record who agreed. Approved days appear in the attendance register and payslip automatically.</div>}
      {rows?.length === 0 && <div className="empty">{status === "pending" ? "No requests are waiting. 🎉" : "No requests."}</div>}
      {rows?.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head"><div><span className="name">{r.staff_name}</span><span className="dept">{r.department || r.designation}</span></div><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></div>
          <div className="title">{range(r)} · {r.days} day{r.days === 1 ? "" : "s"}</div>
          <div className="meta">{cfg.reasons.find((x) => x.key === r.reason_type)?.label}{r.reason ? ` — ${r.reason}` : ""}</div>
          <div className="meta" style={{ marginTop: 4 }}>This month: {r.summary.taken} taken, {r.summary.pending} waiting, {r.summary.freeLeft} free left{r.summary.lopDays ? ` · ${r.summary.lopDays} unpaid` : ""}{r.status === "pending" && r.summary.taken + r.days > r.summary.allowed ? " · ⚠ approving this cuts salary for the extra day(s)" : ""}</div>
          {r.status !== "pending" && <div className="meta">{r.status === "approved" ? `Approved by ${r.mgmt_ok} (recorded by ${r.decided_by_name})` : `Not approved (${r.decided_by_name})`}{r.hr_note ? ` · ${r.hr_note}` : ""}</div>}
          {r.status === "pending" && <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setAsk({ id: r.id, decision: "approved", name: r.staff_name })}>Approve</button>
            <button className="btn btn-danger btn-sm" onClick={() => setAsk({ id: r.id, decision: "rejected", name: r.staff_name })}>Reject</button>
          </div>}
        </div>
      ))}
      {ask && (
        <div className="modal-backdrop" onClick={() => setAsk(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>{ask.decision === "approved" ? "Approve" : "Reject"} leave — {ask.name}</h3>
          {ask.decision === "approved" && <><p className="lead">Who gave the OK?</p>
            {["Sir", "Mam", "Sir & Mam"].map((o) => <label key={o} style={{ display: "flex", gap: 8, padding: "6px 0" }}><input type="radio" checked={ok === o} onChange={() => setOk(o)} /> {o}</label>)}</>}
          <label className="field-label">Note to the staff member (optional)</label>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="actions"><button className="btn btn-outline" onClick={() => setAsk(null)}>Back</button><button className={`btn ${ask.decision === "approved" ? "btn-primary" : "btn-danger"}`} onClick={decide}>{ask.decision === "approved" ? "Approve" : "Reject"}</button></div>
        </div></div>
      )}
    </>
  );
}

function Late() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [d, setD] = useState(null);
  useEffect(() => { api.lateReport(month).then(setD).catch(() => {}); }, [month]);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div className="meta">{d ? `Late = more than ${d.rules.late_grace_min} min after the shift starts. Every ${d.rules.late_limit} late arrivals adds a ₹${d.rules.late_fine} fine, added to the payslip automatically.` : ""}</div>
        <input className="field" type="month" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {d?.rows.length === 0 && <div className="empty">No late arrivals this month.</div>}
      {d?.rows.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head"><div className="name">{r.name}</div><span className={`badge ${r.fine ? "overdue" : "in_progress"}`}>{r.count} late{r.fine ? ` · fine ₹${r.fine}` : ""}</span></div>
          <div className="meta">{r.dates.map((x) => dmy(x.date).replace(/ \d{4}$/, "") + (x.inTime ? ` (${x.inTime})` : "")).join(", ")}</div>
          {r.nextFineIn && <div className="meta">{r.nextFineIn} more late arrival{r.nextFineIn === 1 ? "" : "s"} → next fine</div>}
        </div>
      ))}
      <div className="note">Grooming / dress-code and other fines: add them under Attendance → Fines. They also go to the payslip automatically.</div>
    </>
  );
}

function Birthdays() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.birthdays(366).then(setRows).catch(() => setRows([])); }, []);
  const mon = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  if (!rows) return <div className="empty">Loading…</div>;
  if (!rows.length) return <div className="empty">No dates of birth saved yet. Add them in Staff → Edit.</div>;
  const groups = []; for (const r of rows) { const m = r.inDays === 0 ? "Today" : mon(r.next); (groups.at(-1)?.m === m ? groups.at(-1).r : (groups.push({ m, r: [] }), groups.at(-1).r)).push(r); }
  return groups.map((g) => (
    <div key={g.m} className="card"><div className="title" style={{ marginBottom: 6 }}>{g.m === "Today" ? "🎂 Today" : g.m}</div>
      {g.r.map((b) => <div key={b.id} className="task-row"><div><div className="title">{b.name}</div><div className="meta">{b.department || b.designation || ""}</div></div><div className="meta">{dmy(b.next).replace(/ \d{4}$/, "")}{b.inDays > 0 ? ` · in ${b.inDays} day${b.inDays === 1 ? "" : "s"}` : ""}</div></div>)}
    </div>
  ));
}

function Rules({ cfg, onSaved }) {
  const [s, setS] = useState(cfg.settings); const [msg, setMsg] = useState(null);
  const F = [["casual_per_month", "Free casual leave days per month", "Beyond this, each day cuts one day's salary"], ["salary_divisor", "Days used for one day's salary", "Basic + allowances ÷ this number (30 = per calendar month)"],
    ["late_grace_min", "Minutes allowed after shift start", "More than this = late"], ["late_limit", "Fine after every … late arrivals", "e.g. 3"], ["late_fine", "Fine amount (₹)", "Added to the payslip automatically"]];
  async function save() { try { const r = await api.saveLeaveRules(s); onSaved(r); setMsg({ ok: true, t: "Saved." }); } catch (e) { setMsg({ ok: false, t: e.message }); } }
  return (
    <div className="card">
      <div className="form-grid">{F.map(([k, l, h]) => <div key={k}><label className="field-label">{l}</label><input className="field" type="number" min="0" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /><div className="meta">{h}</div></div>)}</div>
      {msg && <div className={msg.ok ? "note" : "login-error"} style={{ marginTop: 10 }}>{msg.t}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>Save rules</button>
    </div>
  );
}
