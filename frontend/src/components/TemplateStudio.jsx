import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

// Upload Word templates, then generate a personalised document for every staff member in one click.
// kind = 'offer_letter' | 'payslip'.  For payslips, templates can belong to a company (the clinic runs three).
export default function TemplateStudio({ kind, companies = [], roster = [], flash }) {
  const isPay = kind === "payslip";
  const [templates, setTemplates] = useState([]);
  const [generated, setGenerated] = useState([]);
  const [fields, setFields] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [gen, setGen] = useState(null); // template being generated
  const [showFields, setShowFields] = useState(false);

  const load = () => {
    api.listDocTemplates(kind).then(setTemplates).catch(() => {});
    api.listGeneratedDocs(kind).then(setGenerated).catch(() => {});
  };
  useEffect(() => { load(); api.templateFields().then((f) => setFields(f[kind] || [])).catch(() => {}); }, [kind]);

  async function del(t) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try { await api.deleteDocTemplate(t.id); load(); } catch (e) { flash(e.message); }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div><span className="name">{isPay ? "Payslip templates" : "Offer letter templates"}</span>
          <span className="dept">Upload your own Word file once, then generate for everyone</span></div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>+ Upload template</button>
      </div>

      <div className="note">
        <strong>How it works:</strong> write your {isPay ? "payslip" : "offer letter"} in Word the way you want it, and type placeholders like <code>{"{name}"}</code> where each person's details should go.
        {" "}<span className="link" onClick={() => setShowFields((x) => !x)}>{showFields ? "Hide" : "See"} all placeholders</span> ·{" "}
        <span className="link" onClick={() => api.downloadSampleTemplate(kind).catch((e) => flash(e.message))}>Download a sample to start from</span>
        {showFields && <div style={{ marginTop: 8, columnCount: 2, fontSize: 12 }}>{fields.map((f) => <div key={f.key}><code>{`{${f.key}}`}</code> — {f.label}</div>)}</div>}
      </div>

      {templates.length === 0 && <div className="empty">No template uploaded yet.</div>}
      {templates.map((t) => (
        <div key={t.id} className="task-row">
          <div><div className="title">{t.name}</div><div className="meta">{isPay ? (t.company || "All companies") : "Offer letter"} · {t.file_name}</div></div>
          <div className="right" style={{ gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setGen(t)}>Generate…</button>
            <button className="btn btn-ghost btn-sm" onClick={() => api.downloadTemplate(t.id, t.file_name).catch((e) => flash(e.message))}>Download</button>
            <button className="btn btn-ghost btn-sm" onClick={() => del(t)}>Delete</button>
          </div>
        </div>
      ))}

      {generated.length > 0 && <GeneratedList items={generated} onChange={load} flash={flash} />}
      {showUpload && <UploadModal kind={kind} companies={companies} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); flash("Template saved."); load(); }} />}
      {gen && <GenerateModal kind={kind} template={gen} roster={roster} onClose={() => setGen(null)} onDone={(r) => { setGen(null); flash(`Generated ${r.generated.length} document(s)${r.emailed ? ` · emailed ${r.emailed}` : ""}${r.emailFailed?.length ? ` · NOT emailed: ${r.emailFailed.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join(", ")}` : ""}${r.skipped.length ? ` · skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join(", ")}` : ""}`); load(); }} />}
    </div>
  );
}

function GeneratedList({ items, onChange, flash }) {
  const [sel, setSel] = useState(new Set());
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const all = sel.size === items.length;
  async function emailSel(ids) {
    try { const r = await api.emailGenerated(ids); flash(`Emailed ${r.sent.length}${r.failed.length ? ` · not sent: ${r.failed.slice(0, 3).map((f) => `${f.name} (${f.reason})`).join(", ")}` : ""}`); onChange(); } catch (e) { flash(e.message); }
  }
  return (
    <>
      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 15 }}>Generated documents ({items.length})</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel(all ? new Set() : new Set(items.map((i) => i.id)))}>{all ? "Clear" : "Select all"}</button>
          <button className="btn btn-outline btn-sm" disabled={!sel.size} onClick={() => emailSel([...sel])}>Email {sel.size || ""} to staff</button>
          <button className="btn btn-outline btn-sm" disabled={!sel.size} onClick={() => api.downloadGeneratedZip([...sel]).catch((e) => flash(e.message))}>Download {sel.size || ""} as ZIP</button>
        </div>
      </div>
      {items.map((g) => (
        <div key={g.id} className="task-row">
          <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={sel.has(g.id)} onChange={() => toggle(g.id)} />
            <span><div className="title">{g.user_name}</div><div className="meta">{g.emailed_at ? "✉ emailed · " : ""}{g.email_error ? <span style={{ color: "var(--red)" }}>not emailed: {g.email_error} · </span> : null}{[g.company, g.period].filter(Boolean).join(" · ")} · {new Date(g.created_at.replace(" ", "T") + "Z").toLocaleDateString("en-IN")}</div></span>
          </label>
          <div className="right" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => emailSel([g.id])}>Email</button>
            <button className="btn btn-outline btn-sm" onClick={() => api.downloadGenerated(g.id, g.file_name).catch((e) => flash(e.message))}>Download</button>
            <button className="btn btn-ghost btn-sm" onClick={async () => { await api.deleteGenerated(g.id); onChange(); }}>Remove</button>
          </div>
        </div>
      ))}
    </>
  );
}

function UploadModal({ kind, companies, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("kind", kind); fd.append("name", name); fd.append("companyId", companyId);
      if (!file) throw new Error("Choose a Word (.docx) file");
      fd.append("file", file);
      await api.uploadDocTemplate(fd); onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Upload a template</h3>
        <p className="lead">A Word (.docx) file with placeholders such as {"{name}"}.</p>
        <input className="field" type="file" accept=".docx" onChange={(e) => { const f = e.target.files[0]; setFile(f || null); if (f && !name) setName(f.name.replace(/\.docx$/i, "")); }} />
        <label className="field-label">Template name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        {kind === "payslip" && (<>
          <label className="field-label">Company this template is for</label>
          <select className="field" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></>)}
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="actions"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !file} onClick={save}>{busy ? "Checking…" : "Save template"}</button></div>
      </div>
    </div>
  );
}

// Pick people, optionally review and edit every field of each person's document, then generate.
function GenerateModal({ kind, template, roster, onClose, onDone }) {
  const isPay = kind === "payslip";
  const [period, setPeriod] = useState(new Date(Date.now() + 19800000).toISOString().slice(0, 7));
  const [pick, setPick] = useState(kind === "offer_letter" ? "some" : null); // null = everyone
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const people = useMemo(() => roster, [roster]);
  const [chosen, setChosen] = useState(new Set());
  const [review, setReview] = useState(null);   // { fields, people } once "Review & edit" is pressed
  const [edits, setEdits] = useState({});       // { userId: { key: value } } only what the admin changed
  const [open, setOpen] = useState(null);
  const [emailAfter, setEmailAfter] = useState(false);

  const ids = () => (pick === "some" ? [...chosen] : undefined);
  async function loadReview() {
    setBusy(true); setErr("");
    try { const r = await api.prefillDocs({ templateId: template.id, period: isPay ? period : undefined, userIds: ids() }); setReview(r); setEdits({}); setOpen(r.people[0]?.id || null); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const setField = (uid, k, v) => setEdits((e) => ({ ...e, [uid]: { ...(e[uid] || {}), [k]: v } }));
  async function go() {
    setBusy(true); setErr("");
    try { onDone(await api.generateDocs({ templateId: template.id, period: isPay ? period : undefined, userIds: ids(), overrides: edits, emailAfter })); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  const toggle = (id) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const changed = (uid) => Object.keys(edits[uid] || {}).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Generate from “{template.name}”</h3>
        {!review ? (<>
          {isPay && (<><label className="field-label">Pay month</label><input className="field" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            <p className="lead" style={{ marginTop: 8 }}>{template.company ? `Only staff whose salary is set under ${template.company}.` : "Every staff member who has salary details."}</p></>)}
          <div className="tab-switch" style={{ margin: "14px 0" }}>
            <button className={pick === null ? "active" : ""} onClick={() => setPick(null)}>Everyone</button>
            <button className={pick === "some" ? "active" : ""} onClick={() => setPick("some")}>Choose people</button>
          </div>
          {pick === "some" && (
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, padding: 8 }}>
              {people.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 8, padding: "4px 6px", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />{p.name} <span className="meta">· {p.department}</span>
                </label>))}
            </div>)}
          <p className="lead" style={{ marginTop: 10 }}>You can generate straight away, or press <b>Review & edit</b> to change any detail (address, salary, joining date, job duties…) for each person first.</p>
        </>) : (
          <div style={{ maxHeight: "58vh", overflowY: "auto" }}>
            <p className="lead">Everything below fills the document. Change anything that needs to be different for that person — blue ones are changed.</p>
            {review.people.map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <b>{p.name}</b><span className="meta">{changed(p.id) ? `${changed(p.id)} edited · ` : ""}{open === p.id ? "Hide" : "Edit"}</span>
                </div>
                {open === p.id && review.fields.map((f) => {
                  const val = edits[p.id]?.[f.key] ?? p.values[f.key] ?? "";
                  const dirty = edits[p.id] && f.key in edits[p.id];
                  return (
                    <label key={f.key} style={{ display: "grid", gap: 3, marginTop: 8, fontSize: 12.5 }}>{f.label}
                      {f.type === "text"
                        ? <input className="field" style={dirty ? { borderColor: "var(--primary)" } : null} value={val} onChange={(e) => setField(p.id, f.key, e.target.value)} />
                        : <textarea className="field" rows={f.type === "list" ? 6 : 3} style={dirty ? { borderColor: "var(--primary)" } : null} value={val} onChange={(e) => setField(p.id, f.key, e.target.value)} />}
                    </label>);
                })}
              </div>))}
          </div>)}
        {err && <div className="login-error" style={{ marginTop: 12 }}>{err}</div>}
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: 13.5, cursor: "pointer" }}><input type="checkbox" checked={emailAfter} onChange={(e) => setEmailAfter(e.target.checked)} /> Also email each person their {isPay ? "payslip" : "letter"} (to the email on their profile)</label>
        <div className="actions">
          <button className="btn btn-ghost" onClick={review ? () => setReview(null) : onClose}>{review ? "← Back" : "Cancel"}</button>
          {!review && <button className="btn btn-outline" disabled={busy || (pick === "some" && !chosen.size)} onClick={loadReview}>{busy ? "Loading…" : "Review & edit"}</button>}
          <button className="btn btn-primary" disabled={busy || (pick === "some" && !chosen.size)} onClick={go}>{busy ? "Generating…" : "Generate"}</button>
        </div>
      </div>
    </div>
  );
}
