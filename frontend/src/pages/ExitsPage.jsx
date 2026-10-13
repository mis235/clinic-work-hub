import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const plus30 = (d) => new Date(new Date(d + "T00:00:00Z").getTime() + 30 * 86400000).toISOString().slice(0, 10);
const LETTERS = [
  { kind: "relieving_letter", label: "Relieving letter", after: "paid" },
  { kind: "experience_letter", label: "Experience certificate", after: "paid" },
  { kind: "fnf_statement", label: "Full & final settlement statement", after: "settlement" },
];
const ORDER = ["received", "notice", "handover", "settlement", "paid", "relieved"];
const badge = (s) => (s === "relieved" ? "done" : s === "withdrawn" ? "accepted" : "overdue");

export default function ExitsPage({ user, onLogout, onBack }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [wording, setWording] = useState(false);
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 4000); };
  const load = () => api.exitsList().then(setList).catch((e) => { setList([]); flash(e.message); });
  useEffect(() => { load(); }, []);

  return (
    <PageShell user={user} active="Exits" title="Staff exits" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">People</div><h1>Staff exits</h1>
          <p>When someone leaves: record it, follow the steps, settle their dues, then issue the relieving letter and experience certificate.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setWording((x) => !x)}>Letter wording</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Start an exit</button>
        </div>
      </div>

      {wording && <WordingCard flash={flash} />}

      {openId ? <ExitDetail id={openId} flash={flash} onClose={() => { setOpenId(null); load(); }} /> : (
        !list ? <div className="empty">Loading…</div> : list.length === 0 ? <div className="empty">No exits yet. Use “Start an exit” when someone resigns or their contract ends.</div> : (
          <div className="card">
            {list.map((e) => (
              <div key={e.id} className="task-row" style={{ cursor: "pointer" }} onClick={() => setOpenId(e.id)}>
                <div><div className="title">{e.staff_name}</div>
                  <div className="meta">{e.department || "—"} · {e.reason_label} · last day {e.last_working_day}</div></div>
                <span className={`badge ${badge(e.status)}`}>{e.status_label}</span>
              </div>
            ))}
          </div>
        )
      )}
      {adding && <StartModal onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); load(); setOpenId(id); }} />}
      {toast && <div className="toast">{toast}</div>}
    </PageShell>
  );
}

function StartModal({ onClose, onDone }) {
  const [staff, setStaff] = useState([]);
  const [f, setF] = useState({ userId: "", reasonType: "resignation", resignationDate: todayIST(), lastWorkingDay: plus30(todayIST()), reasonNote: "" });
  const [lwdEdited, setLwdEdited] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.listRosterFull().then(setStaff).catch(() => {}); }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  function pickDate(v) { set("resignationDate", v); if (!lwdEdited && v) set("lastWorkingDay", plus30(v)); }
  async function save() {
    try { const r = await api.exitStart(f); onDone(r.id); } catch (e) { setErr(e.message); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <h3>Start an exit</h3>
      <label className="field-label">Who is leaving?</label>
      <select className="field" value={f.userId} onChange={(e) => set("userId", e.target.value)}>
        <option value="">Choose…</option>{staff.filter((s) => s.active !== 0).map((s) => <option key={s.id} value={s.id}>{s.name}{s.department ? ` — ${s.department}` : ""}</option>)}
      </select>
      <label className="field-label">Reason</label>
      <select className="field" value={f.reasonType} onChange={(e) => set("reasonType", e.target.value)}>
        <option value="resignation">Resignation</option><option value="termination">Termination</option><option value="contract_end">End of contract</option>
      </select>
      <label className="field-label">Date of resignation / notice</label>
      <input className="field" type="date" value={f.resignationDate} onChange={(e) => pickDate(e.target.value)} />
      <label className="field-label">Last working day (30 days is filled in; change it if agreed otherwise)</label>
      <input className="field" type="date" value={f.lastWorkingDay} onChange={(e) => { setLwdEdited(true); set("lastWorkingDay", e.target.value); }} />
      <label className="field-label">Note (optional)</label>
      <input className="field" value={f.reasonNote} onChange={(e) => set("reasonNote", e.target.value)} placeholder="e.g. higher studies" />
      {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
      <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Start</button></div>
    </div></div>
  );
}

function ExitDetail({ id, flash, onClose }) {
  const [x, setX] = useState(null);
  const [inp, setInp] = useState({});
  const apply = (r) => { setX(r); setInp(r.settlement.inputs); };
  useEffect(() => { api.exitGet(id).then(apply).catch((e) => flash(e.message)); }, [id]);
  if (!x) return <div className="empty">Loading…</div>;
  const idx = ORDER.indexOf(x.status), closed = x.status === "relieved" || x.status === "withdrawn";
  const run = (fn, ok) => async () => { try { apply(await fn()); if (ok) flash(ok); } catch (e) { flash(e.message); } };
  const tick = (key, v) => run(() => api.exitUpdate(id, { clearance: { [key]: v } }))();
  const s = x.settlement;
  const num = (k, label, hint) => (
    <label key={k} style={{ display: "grid", gap: 4, fontSize: 12.5 }}>{label}
      <input className="field" type="number" min="0" disabled={closed} value={inp[k] ?? 0} onChange={(e) => setInp({ ...inp, [k]: e.target.value })} />
      {hint && <span className="meta">{hint}</span>}
    </label>);
  async function make(kind) {
    try { const r = await api.exitLetter(id, kind); flash(`Created using ${r.used}.`); await api.downloadGenerated(r.id, r.file_name); apply(await api.exitGet(id)); } catch (e) { flash(e.message); }
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}><button className="btn btn-ghost btn-sm" onClick={onClose}>← All exits</button></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><div className="title" style={{ fontSize: 18 }}>{x.staff_name}</div>
            <div className="meta">{x.designation || ""} · {x.department || "—"} · {x.reason_label} · joined {x.joined_at?.slice(0, 10) || "—"} · service {x.tenure || "—"}</div>
            <div className="meta">Notice given {x.resignation_date} · last working day {x.last_working_day}{x.reason_note ? ` · ${x.reason_note}` : ""}</div></div>
          <span className={`badge ${badge(x.status)}`}>{x.status === "withdrawn" ? "Withdrawn" : x.statuses[idx].label}</span>
        </div>
        {/* status steps */}
        <div className="steps">
          {x.statuses.map((st, i) => (
            <div key={st.key} className={`step ${i < idx || x.status === "relieved" ? "done" : i === idx && x.status !== "withdrawn" ? "now" : ""}`}><span>{i + 1}</span>{st.label}</div>
          ))}
        </div>
        {!closed && <div className="note" style={{ marginTop: 10 }}><b>Now:</b> {x.statuses[idx].hint}</div>}
        {!closed && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {idx < ORDER.length - 1 && <button className="btn btn-primary btn-sm" onClick={run(() => api.exitAdvance(id), "Moved to the next step.")}>Next step: {x.statuses[idx + 1].label} →</button>}
            {idx > 0 && <button className="btn btn-ghost btn-sm" onClick={run(() => api.exitBack(id))}>← Back one step</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => window.confirm("Cancel this exit? The person keeps working.") && run(() => api.exitWithdraw(id), "Exit withdrawn.")()}>Withdraw exit</button>
          </div>)}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="title" style={{ marginBottom: 6 }}>Clearance checklist (all needed before settlement)</div>
        {x.clearance_items.map((c) => (
          <label key={c.key} className="task-row" style={{ cursor: closed ? "default" : "pointer" }}>
            <div className="title" style={{ fontWeight: 500 }}>{c.label}</div>
            <input type="checkbox" disabled={closed} checked={!!x.clearance[c.key]} onChange={(e) => tick(c.key, e.target.checked)} />
          </label>))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="title" style={{ marginBottom: 2 }}>Full & final settlement</div>
        <div className="meta" style={{ marginBottom: 10 }}>{s.has_pay_profile ? `Monthly pay ${rupee(s.monthly_gross)} → ${rupee(s.per_day)} per day (30-day month). Leave is counted on basic.` : "⚠ No salary details for this person yet — add them under Payroll so amounts are worked out."}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {num("unpaid_days", "Unpaid working days", `= ${rupee(s.pending_salary)}`)}
          {num("leave_days", "Leave days to pay out", `= ${rupee(s.leave_encashment)}`)}
          {num("bonus", "Bonus / incentive (₹)")}
          {num("other_earnings", "Other payments (₹)")}
          {num("notice_short_days", "Notice days not served", `recover ${rupee(s.notice_recovery)}`)}
          {num("advance", "Advance / loan to recover (₹)")}
          {num("other_deductions", "Other deductions (₹)")}
        </div>
        <div className="meta" style={{ marginTop: 8 }}>Fines in {x.last_working_day.slice(0, 7)} are taken automatically: {rupee(s.fines)}</div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <div><span className="badge accepted">Payable {rupee(s.total_earnings)}</span> <span className="badge overdue">Recoveries {rupee(s.total_deductions)}</span>
            <div className="title" style={{ marginTop: 8, fontSize: 18 }}>Net: {rupee(s.net)} <span className="meta">({s.net_words} rupees)</span></div></div>
          {!closed && <button className="btn btn-primary btn-sm" onClick={run(() => api.exitUpdate(id, { settlement: inp }), "Settlement sheet saved.")}>Save sheet</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="title" style={{ marginBottom: 6 }}>Letters</div>
        {LETTERS.map((l) => {
          const ready = x.status !== "withdrawn" && idx >= ORDER.indexOf(l.after) && (l.kind !== "fnf_statement" || !!x.settlement_saved);
          const made = x.letters.filter((d) => d.kind === l.kind);
          return (
            <div key={l.kind} className="task-row">
              <div><div className="title">{l.label}</div>
                <div className="meta">{ready ? (made.length ? `Created ${made[0].created_at.slice(0, 10)}` : "Ready to create") : l.kind === "fnf_statement" ? "Save the settlement sheet first" : "Available once the settlement is marked paid"}</div></div>
              <div className="right" style={{ gap: 8 }}>
                {made[0] && <button className="btn btn-ghost btn-sm" onClick={() => api.downloadGenerated(made[0].id, made[0].file_name).catch((e) => flash(e.message))}>Download</button>}
                <button className="btn btn-outline btn-sm" disabled={!ready} onClick={() => make(l.kind)}>{made.length ? "Create again" : "Create"}</button>
              </div>
            </div>);
        })}
      </div>

      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>History</div>
        {x.events.map((e, i) => <div key={i} className="task-row"><div className="meta">{e.text}</div><div className="meta">{e.at?.slice(0, 16)}{e.by_name ? ` · ${e.by_name}` : ""}</div></div>)}
      </div>
    </>
  );
}

// Use the standard wording, or upload your own Word file with {placeholders}.
function WordingCard({ flash }) {
  const [tpls, setTpls] = useState([]);
  const [fields, setFields] = useState({});
  const load = () => api.listDocTemplates().then((t) => setTpls(t.filter((x) => LETTERS.some((l) => l.kind === x.kind)))).catch(() => {});
  useEffect(() => { load(); api.templateFields().then(setFields).catch(() => {}); }, []);
  async function upload(kind, file) {
    if (!file) return;
    const fd = new FormData(); fd.append("kind", kind); fd.append("name", file.name.replace(/\.docx$/i, "")); fd.append("companyId", ""); fd.append("file", file);
    try { await api.uploadDocTemplate(fd); flash("Template saved."); load(); } catch (e) { flash(e.message); }
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="title" style={{ marginBottom: 4 }}>Letter wording</div>
      <div className="meta" style={{ marginBottom: 8 }}>By default the app writes the standard sentences. To use your own letterhead and wording, download the sample, edit it in Word (keep the {"{placeholders}"}), and upload it here.</div>
      {LETTERS.map((l) => {
        const mine = tpls.filter((t) => t.kind === l.kind);
        return (
          <div key={l.kind} className="task-row" style={{ alignItems: "flex-start" }}>
            <div><div className="title">{l.label}</div>
              <div className="meta">{mine.length ? `Using your file: ${mine[0].name}` : "Using the standard wording"}</div>
              <details><summary className="meta" style={{ cursor: "pointer" }}>Placeholders you can use</summary>
                <div style={{ fontSize: 12, columnCount: 2 }}>{(fields[l.kind] || []).map((f) => <div key={f.key}><code>{`{${f.key}}`}</code> {f.label}</div>)}</div></details></div>
            <div className="right" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => api.downloadSampleTemplate(l.kind).catch((e) => flash(e.message))}>Sample</button>
              <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>Upload<input type="file" accept=".docx" hidden onChange={(e) => { upload(l.kind, e.target.files[0]); e.target.value = ""; }} /></label>
              {mine[0] && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api.deleteDocTemplate(mine[0].id); load(); } catch (e) { flash(e.message); } }}>Use standard</button>}
            </div>
          </div>);
      })}
    </div>
  );
}
