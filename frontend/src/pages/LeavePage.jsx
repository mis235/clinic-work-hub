import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function Chain({ r }) {
  const steps = [{ label: "HR", state: r.status === "pending" ? "wait" : "ok" }, ...(r.chain || []).map((c) => ({ label: `${c.label === "Owner" ? "Dr. Nishita" : c.label}${c.name ? " · " + c.name.split(" ")[0] : ""}`, state: c.status === "approved" ? "ok" : c.status === "rejected" ? "no" : "wait" }))];
  if (r.status === "cancelled") return null;
  const cur = steps.findIndex((x) => x.state === "wait");
  return (
    <div className="leave-chain">
      {steps.map((x, i) => <span key={i} className={`leave-step ${x.state} ${i === cur && r.status !== "rejected" ? "now" : ""}`}>{x.state === "ok" ? "✓ " : x.state === "no" ? "✗ " : ""}{x.label}</span>)}
    </div>
  );
}
const range = (r) => (r.from_date === r.to_date ? dmy(r.from_date) : `${dmy(r.from_date)} – ${dmy(r.to_date)}`);
const STATUS = { pending: ["Waiting for HR", "in_progress"], with_management: ["Waiting for signatures", "accepted"], approved: ["Approved", "done"], rejected: ["Not approved", "overdue"], cancelled: ["Cancelled", ""] };

export default function LeavePage({ user, onLogout, onBack, isStaffLayout }) {
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("mine");
  useEffect(() => { api.leaveConfig().then(setCfg).catch(() => setCfg({ isHr: false, reasons: [], settings: {} })); }, []);
  if (!cfg) return <PageShell user={user} active="Leave" title="Leave & HR" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}><div className="empty">Loading…</div></PageShell>;
  const tabs = [["mine", "My leave"], ["sign", "To sign"], ["cover", "Covering for others"], ["sig", "My signature"], ...(cfg.isHr ? [["approve", "Approvals"], ["all", "All requests"], ["late", "Late & fines"], ["bday", "Birthdays"], ["rules", "HR rules"]] : [])];
  return (
    <PageShell user={user} active="Leave" title="Leave & HR" isStaffLayout={isStaffLayout} onLogout={onLogout} onBack={onBack}>
      <div className="page-head"><div className="eyebrow">People</div><h1>Leave &amp; HR</h1><p>Apply for leave, see your balance, and (for HR) approve requests, late arrivals and birthdays.</p></div>
      {tabs.length > 1 && <div className="pills leave-tabs" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>{tabs.map(([k, l]) => <button key={k} className={`pill ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === "mine" && <Mine cfg={cfg} />}
      {tab === "sign" && <ToSign />}
      {tab === "cover" && <Covering />}
      {tab === "sig" && <MySignature />}
      {tab === "approve" && <Requests cfg={cfg} status="open" />}
      {tab === "all" && <Requests cfg={cfg} />}
      {tab === "late" && <Late />}
      {tab === "bday" && <Birthdays />}
      {tab === "rules" && <Rules cfg={cfg} onSaved={(s) => setCfg({ ...cfg, settings: s })} />}
    </PageShell>
  );
}

function Mine({ cfg }) {
  const [d, setD] = useState(null);
  const [mates, setMates] = useState([]);
  useEffect(() => { api.leaveColleagues().then(setMates).catch(() => {}); }, []);
  const [f, setF] = useState({ fromDate: todayIST(), toDate: todayIST(), halfDay: false, reasonType: "sick", reason: "", coverUserId: "", coverNote: "" });
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.myLeave().then(setD).catch((e) => setMsg({ ok: false, t: e.message }));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const days = f.halfDay ? 0.5 : Math.max(1, Math.round((new Date(f.toDate) - new Date(f.fromDate)) / 86400000) + 1);
  async function apply() {
    setBusy(true); setMsg(null);
    try { const r = await api.applyLeave(f); setMsg({ ok: true, t: "Sent to HR. It then goes to COS, the Director and Dr. Nishita for signature. " + (r.warning || "You will see the answer here and on your home screen.") }); setF({ ...f, reason: "", coverNote: "" }); load(); }
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
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div><label className="field-label">Who will do your work while you are away?</label>
            <select className="field" value={f.coverUserId} onChange={set("coverUserId")}><option value="">— choose a colleague —</option>{mates.map((m) => <option key={m.id} value={m.id}>{m.name}{m.designation ? ` (${m.designation})` : ""}</option>)}</select></div>
          <div><label className="field-label">Handover note (optional)</label><input className="field" value={f.coverNote} onChange={set("coverNote")} placeholder="e.g. keys with front desk, pending calls list" /></div>
        </div>
        <div className="meta" style={{ marginTop: 4 }}>Once your leave is approved, your colleague sees your checklist and tasks in their own login for those days.</div>
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
              <div className="meta">{cfg.reasons.find((x) => x.key === r.reason_type)?.label}{r.reason ? ` — ${r.reason}` : ""}{r.hr_note ? ` · HR: ${r.hr_note}` : ""}{r.mgmt_ok ? ` · approved by ${r.mgmt_ok}` : ""}{r.cover_name ? ` · work covered by ${r.cover_name}` : ""}</div>
              <Chain r={r} /></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => api.openLeaveLetter(r.id)}>Open letter (PDF)</button>
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
  async function confirm(id) { try { await api.confirmLeave(id, {}); load(); } catch (e) { setMsg(e.message); } }
  async function decide() {
    try { await api.decideLeave(ask.id, { decision: ask.decision, mgmtOk: ok, note }); setAsk(null); setNote(""); load(); } catch (e) { setMsg(e.message); }
  }
  return (
    <>
      {msg && <div className="login-error">{msg}</div>}
      {status === "open" && <div className="meta" style={{ marginBottom: 10 }}>1) Check the leave letter and press <b>Letter received</b>. 2) It goes by itself to COS, then the Director, then Dr. Nishita — each signs on their own login. 3) After the last signature the leave is approved, signatures appear on the letter and the staff member is told. <i>Approve / Reject</i> below are only for leave signed on paper (HR records who signed).</div>}
      {rows?.length === 0 && <div className="empty">{status === "open" ? "No requests are waiting. 🎉" : "No requests."}</div>}
      {rows?.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head"><div><span className="name">{r.staff_name}</span><span className="dept">{r.department || r.designation}{r.hr_confirmed_at ? " · HR received the letter" : ""}</span></div><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></div>
          <div className="title">{range(r)} · {r.days} day{r.days === 1 ? "" : "s"}</div>
          <div className="meta">{cfg.reasons.find((x) => x.key === r.reason_type)?.label}{r.reason ? ` — ${r.reason}` : ""}{r.cover_name ? ` · work covered by ${r.cover_name}` : ""}</div>
          <Chain r={r} />
          <div className="meta" style={{ marginTop: 4 }}>This month: {r.summary.taken} taken, {r.summary.pending} waiting, {r.summary.freeLeft} free left{r.summary.lopDays ? ` · ${r.summary.lopDays} unpaid` : ""}{["pending", "with_management"].includes(r.status) && r.summary.taken + r.days > r.summary.allowed ? " · ⚠ approving this cuts salary for the extra day(s)" : ""}</div>
          {!["pending", "with_management"].includes(r.status) && <div className="meta">{r.status === "approved" ? `Approved by ${r.mgmt_ok} (recorded by ${r.decided_by_name})` : `Not approved (${r.decided_by_name})`}{r.hr_note ? ` · ${r.hr_note}` : ""}</div>}
          {(r.status === "pending" || r.status === "with_management") && <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {r.status === "pending" && <button className="btn btn-outline btn-sm" onClick={() => confirm(r.id)}>Letter received → send to COS, Director &amp; Dr. Nishita</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk({ id: r.id, decision: "approved", name: r.staff_name })}>Paper-signed: approve</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk({ id: r.id, decision: "rejected", name: r.staff_name })}>Reject</button>
            <button className="btn btn-ghost btn-sm" onClick={() => api.openLeaveLetter(r.id)}>Open letter (PDF)</button>
          </div>}
          {(r.status === "approved" || r.status === "rejected") && <div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => api.openLeaveLetter(r.id)}>Open letter (PDF)</button></div>}
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

function ToSign() {
  const [d, setD] = useState(null); const [msg, setMsg] = useState(null); const [note, setNote] = useState({});
  const load = () => api.leaveApprovals().then(setD).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  async function act(id, decision) {
    setMsg(null);
    try { await api.approveLeave(id, { decision, note: note[id] || "" }); load(); } catch (e) { setMsg(e.message); }
  }
  if (!d) return <div className="empty">{msg || "Loading…"}</div>;
  return (
    <>
      {msg && <div className="login-error">{msg}</div>}
      {!d.hasSignature && d.waiting.length > 0 && <div className="note" style={{ marginBottom: 10 }}>Add your signature first (tab <b>My signature</b>) — it is put on the letter when you approve.</div>}
      {d.waiting.length === 0 && <div className="empty">Nothing is waiting for your signature.</div>}
      {d.waiting.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head"><div><span className="name">{r.staff_name}</span><span className="dept">{r.department || r.designation}</span></div></div>
          <div className="title">{range(r)} · {r.days} day{r.days === 1 ? "" : "s"}</div>
          <div className="meta">{r.reason || ""}{r.cover_name ? ` · work covered by ${r.cover_name}` : ""}</div>
          <Chain r={r} />
          <input className="field" style={{ marginTop: 8 }} placeholder="Note (optional)" value={note[r.id] || ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={() => act(r.id, "approved")}>Approve &amp; sign</button>
            <button className="btn btn-danger btn-sm" onClick={() => act(r.id, "rejected")}>Not approved</button>
            <button className="btn btn-ghost btn-sm" onClick={() => api.openLeaveLetter(r.id)}>Open letter (PDF)</button>
          </div>
        </div>
      ))}
      {d.done.length > 0 && <div className="card"><div className="title" style={{ marginBottom: 6 }}>Signed by me</div>
        {d.done.map((r) => <div key={r.id} className="task-row"><div><div className="title">{r.staff_name}</div><div className="meta">{range(r)}</div></div><button className="btn btn-ghost btn-sm" onClick={() => api.openLeaveLetter(r.id)}>Letter</button></div>)}</div>}
    </>
  );
}

function MySignature() {
  const [sig, setSig] = useState(null); const [msg, setMsg] = useState(null); const [editing, setEditing] = useState(false);
  const load = () => api.leaveSignature().then((r) => { setSig(r); setEditing(!r.has); }).catch(() => {});
  useEffect(() => { load(); }, []);
  async function save(dataUrl) { try { await api.saveLeaveSignature(dataUrl); setMsg({ ok: true, t: "Signature saved." }); load(); } catch (e) { setMsg({ ok: false, t: e.message }); } }
  return (
    <div className="card">
      <div className="title" style={{ marginBottom: 4 }}>My signature</div>
      <p className="meta" style={{ marginTop: 0 }}>Draw it once with your finger or mouse. It is put on leave letters only when you approve, and on your own leave letters.</p>
      {sig?.has && !editing && <><img src={sig.dataUrl} alt="My signature" style={{ background: "#fff", border: "1px solid var(--line, #ddd)", borderRadius: 8, maxWidth: 300, width: "100%" }} />
        <div style={{ marginTop: 10 }}><button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Draw again</button></div></>}
      {editing && <SignaturePad onSave={save} />}
      {msg && <div className={msg.ok ? "note" : "login-error"} style={{ marginTop: 10 }}>{msg.t}</div>}
    </div>
  );
}

function Covering() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.leaveCovering().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="empty">Loading…</div>;
  if (!rows.length) return <div className="empty">Nobody has asked you to cover their work.</div>;
  return rows.map((c) => (
    <div key={c.id} className="card">
      <div className="card-head"><div className="name">Covering for {c.staffName}</div><span className={`badge ${c.active ? "in_progress" : ""}`}>{c.active ? "On leave now" : `From ${dmy(c.fromDate)}`}</span></div>
      <div className="meta">{range({ from_date: c.fromDate, to_date: c.toDate })}{c.note ? ` · Note: ${c.note}` : ""}</div>
      <div className="title" style={{ marginTop: 10 }}>Their open tasks ({c.tasks.length})</div>
      {c.tasks.length === 0 && <div className="meta">No open tasks.</div>}
      {c.tasks.map((t) => <div key={t.id} className="task-row"><div><div className="title">{t.title}</div><div className="meta">{t.category}{t.due_date ? ` · due ${dmy(t.due_date)}` : ""}</div></div><span className="badge in_progress">{t.status.replace("_", " ")}</span></div>)}
      {c.sections.length > 0 && <div className="title" style={{ marginTop: 10 }}>Their shift checklist ({c.roleName})</div>}
      {c.sections.map((s) => <div key={s.section} style={{ marginTop: 6 }}><div className="meta"><b>{s.section}</b></div>{s.items.map((i, k) => <div key={k} className="meta">☐ {i}</div>)}</div>)}
    </div>
  ));
}
