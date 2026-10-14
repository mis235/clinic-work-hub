import { useEffect, useMemo, useRef, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api, assetUrl } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import Icon from "../components/Icon.jsx";

const keyOf = (section, text) => `${section}|||${text}`;
const defaultShift = () => (new Date().getHours() < 14 ? "Morning" : "Evening");

export default function ShiftChecklistPage({ user, isStaffLayout, onLogout, onBack }) {
  const [template, setTemplate] = useState(null);   // { roleName, sections, metrics }
  const [notAssigned, setNotAssigned] = useState(null);
  const [existing, setExisting] = useState([]);     // today's rows (in_progress or submitted), any shift
  const [shift, setShift] = useState(defaultShift());
  const [checked, setChecked] = useState({});
  const [metricValues, setMetricValues] = useState({});
  const [photos, setPhotos] = useState({});        // per-task photos: key -> { url, at }
  const [uploadingKey, setUploadingKey] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoCapturedAt, setPhotoCapturedAt] = useState(null);
  const [editing, setEditing] = useState(false);    // re-opening an already-submitted shift
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loadedKey = useRef("");                     // which shift's saved state is currently loaded into the form
  const saveTimer = useRef(null);

  useEffect(() => {
    api.getShiftChecklistTemplate().then(setTemplate).catch((e) => setNotAssigned(e.message));
    api.getShiftChecklistToday().then(setExisting).catch(() => setExisting([]));
  }, []);

  const todays = existing.find((s) => s.shift === shift);

  // Restore ticks/numbers saved earlier today whenever the shift (or the loaded data) changes.
  useEffect(() => {
    if (!template) return;
    const id = `${shift}:${todays?.id || "none"}`;
    if (loadedKey.current === id) return;
    loadedKey.current = id;
    const c = {};
    const ph = {};
    (todays?.items || []).forEach((i) => { if (i.done) c[keyOf(i.section, i.text)] = true; if (i.photoUrl) ph[keyOf(i.section, i.text)] = { url: i.photoUrl, at: i.photoAt }; });
    setChecked(c); setPhotos(ph);
    setMetricValues(todays?.metrics || {});
    setEditing(false);
  }, [template, shift, todays]);

  const allItems = useMemo(() => (template ? template.sections.flatMap((s) => s.items.map((t) => ({ section: s.section, text: t }))) : []), [template]);
  const doneCount = allItems.filter((i) => checked[keyOf(i.section, i.text)]).length;
  const pct = allItems.length ? Math.round((doneCount / allItems.length) * 100) : 0;
  const buildItems = () => allItems.map((i) => { const ph = photos[keyOf(i.section, i.text)]; return { ...i, done: !!checked[keyOf(i.section, i.text)], ...(ph ? { photoUrl: ph.url, photoAt: ph.at } : {}) }; });

  // Autosave 0.7s after the last change, so progress is never lost and managers see it live.
  const dirty = useRef(false);
  useEffect(() => {
    if (!template || !dirty.current) return;
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await api.saveShiftProgress({ shift, items: buildItems(), metrics: template.metrics.length ? metricValues : null });
        loadedKey.current = `${shift}:${saved.id}`;
        setExisting((prev) => [...prev.filter((s) => s.shift !== shift), saved]);
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 700);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, metricValues, photos]);

  function toggle(section, text) {
    dirty.current = true;
    setChecked((c) => ({ ...c, [keyOf(section, text)]: !c[keyOf(section, text)] }));
  }
  async function attachPhoto(section, text, file) {
    if (!file) return;
    const k = keyOf(section, text); setUploadingKey(k); setError("");
    try { const r = await api.shiftItemPhoto(file); dirty.current = true; setPhotos((p) => ({ ...p, [k]: { url: r.url, at: r.takenAt } })); setChecked((c) => ({ ...c, [k]: true })); }
    catch (e) { setError(`Photo not saved: ${e.message}`); }
    setUploadingKey("");
  }
  function dropPhoto(section, text) { dirty.current = true; setPhotos((p) => { const n = { ...p }; delete n[keyOf(section, text)]; return n; }); }
  function setMetric(field, value) {
    dirty.current = true;
    setMetricValues((m) => ({ ...m, [field]: value }));
  }
  function markSectionDone(sec) {
    dirty.current = true;
    setChecked((c) => { const n = { ...c }; sec.items.forEach((t) => (n[keyOf(sec.section, t)] = true)); return n; });
  }
  function onPhotoChange(e) {
    const file = e.target.files?.[0] || null;
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
    setPhotoCapturedAt(file ? new Date().toISOString() : null);
  }

  async function submit() {
    if (!template) return;
    setSubmitting(true);
    setError("");
    try {
      clearTimeout(saveTimer.current);
      const fd = new FormData();
      fd.append("shift", shift);
      fd.append("items", JSON.stringify(buildItems()));
      if (template.metrics.length > 0) fd.append("metrics", JSON.stringify(metricValues));
      if (photoCapturedAt) fd.append("photoLiveTimestamp", photoCapturedAt);
      if (photoFile) fd.append("photo", photoFile);
      const saved = await api.submitShiftChecklist(fd);
      loadedKey.current = `${shift}:${saved.id}`;
      setExisting((prev) => [...prev.filter((s) => s.shift !== shift), saved]);
      setPhotoFile(null); setPhotoPreview(null); setPhotoCapturedAt(null);
      setEditing(false); setSaveState("idle"); dirty.current = false;
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const showSubmitted = todays?.status === "submitted" && !editing;

  const body = (
    <>
      <div className="page-head row">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>My Shift Checklist</h1>
          <p>{template ? `${template.roleName}.` : "Your role's recurring Opening / During the day / End of day checklist."} Your ticks save automatically — you can leave and come back.</p>
        </div>
      </div>

      {notAssigned && <div className="empty">{notAssigned}</div>}

      {template && (
        <>
          <div className="tab-switch" style={{ maxWidth: 300 }}>
            <button className={shift === "Morning" ? "active" : ""} onClick={() => setShift("Morning")}>Morning shift</button>
            <button className={shift === "Evening" ? "active" : ""} onClick={() => setShift("Evening")}>Evening shift</button>
          </div>

          {showSubmitted ? (
            <SubmittedView submission={todays} onEdit={() => { setEditing(true); }} />
          ) : (
            <>
              <div className="card" style={{ position: "sticky", top: 8, zIndex: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{doneCount} of {allItems.length} tasks done · {pct}%</div>
                  <span className={`savedot ${saveState === "saving" ? "saving" : ""}`}>
                    {saveState === "saving" && "Saving…"}
                    {saveState === "saved" && <><Icon name="check" size={13} strokeWidth={3} /> Saved automatically</>}
                    {saveState === "error" && <span style={{ color: "var(--red)" }}>Could not save — check connection</span>}
                    {saveState === "idle" && todays?.status === "in_progress" && "Progress restored"}
                  </span>
                </div>
                <div className={`progress lg ${pct === 100 ? "green" : ""}`}><span style={{ width: `${pct}%` }} /></div>
              </div>

              {template.sections.map((sec) => {
                const secDone = sec.items.filter((t) => checked[keyOf(sec.section, t)]).length;
                return (
                  <div key={sec.section} className="card">
                    <div className="card-head" style={{ alignItems: "center" }}>
                      <div className="name">{sec.section} <span className="meta" style={{ marginLeft: 6 }}>{secDone}/{sec.items.length}</span></div>
                      {secDone < sec.items.length && <button className="btn btn-ghost btn-sm" onClick={() => markSectionDone(sec)}>Mark all done</button>}
                    </div>
                    {sec.items.map((text) => {
                      const on = !!checked[keyOf(sec.section, text)];
                      return (
                        <div key={text} className="check-row">
                          <label className={`check-item ${on ? "on" : ""}`}>
                            <input type="checkbox" checked={on} onChange={() => toggle(sec.section, text)} />
                            <span className="box">{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
                            <span className="txt">{text}</span>
                          </label>
                          {photos[keyOf(sec.section, text)]
                            ? <span className="task-photo"><a href={assetUrl(photos[keyOf(sec.section, text)].url)} target="_blank" rel="noreferrer"><img alt="Task photo" src={assetUrl(photos[keyOf(sec.section, text)].url)} /></a><button className="btn btn-ghost btn-sm" title="Remove photo" onClick={() => dropPhoto(sec.section, text)}>✕</button></span>
                            : <label className="btn btn-outline btn-sm cam-btn" title="Take a photo for this task">{uploadingKey === keyOf(sec.section, text) ? "…" : "📷"}
                                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { attachPhoto(sec.section, text, e.target.files?.[0]); e.target.value = ""; }} /></label>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {template.metrics.length > 0 && (
                <div className="card">
                  <div className="card-head"><div className="name">Today's numbers</div></div>
                  <div className="form-grid">
                    {template.metrics.map((field) => (
                      <div key={field}>
                        <label className="field-label" style={{ marginTop: 6 }}>{field}</label>
                        <input className="field" value={metricValues[field] || ""} onChange={(e) => setMetric(field, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-head"><div className="name">Photo evidence <span className="meta">(optional)</span></div></div>
                <div className="meta" style={{ marginBottom: 12 }}>Take a live photo as proof — a stocked shelf, a cleaned room, or your check-in sheet.</div>
                <input type="file" accept="image/*" capture="environment" onChange={onPhotoChange} />
                {photoPreview && <img src={photoPreview} alt="Preview" style={{ marginTop: 12, maxWidth: 200, borderRadius: 14, display: "block" }} />}
              </div>

              {error && <div className="login-error">{error}</div>}

              <div className="sticky-bar">
                <button className="btn btn-primary" style={{ width: "100%", padding: "14px 18px" }} disabled={submitting} onClick={submit}>
                  {submitting ? "Submitting…" : `Submit ${shift} checklist (${pct}%)`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );

  if (isStaffLayout) return <div>{body}</div>;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Shift Checklist"
        onSelect={(item) => item !== "Shift Checklist" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="main">
        <MobileTopBar title="Shift Checklist" onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </main>
    </div>
  );
}

function SubmittedView({ submission, onEdit }) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Submitted — {submission.completionPct}% complete</div>
        <span className={`badge ${submission.completionPct === 100 ? "done" : "in_progress"}`}>{submission.completed}/{submission.total} done</span>
      </div>
      <div className={`progress lg ${submission.completionPct === 100 ? "green" : "amber"}`}><span style={{ width: `${submission.completionPct}%` }} /></div>
      {(submission.items || []).some((i) => i.photoUrl) && <div className="meta" style={{ marginTop: 14 }}>Task photos<div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{submission.items.filter((i) => i.photoUrl).map((i) => <a key={i.text} href={assetUrl(i.photoUrl)} target="_blank" rel="noreferrer" title={i.text}><img alt={i.text} src={assetUrl(i.photoUrl)} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10 }} /></a>)}</div></div>}
      {submission.photoUrl && <img src={assetUrl(submission.photoUrl)} alt="Submitted evidence" style={{ maxWidth: 240, borderRadius: 14, display: "block", marginTop: 14 }} />}
      {submission.photoAiCheck && <div className="note" style={{ marginTop: 14, marginBottom: 0 }}>AI photo check: {submission.photoAiCheck}</div>}
      <div className="meta" style={{ marginTop: 12 }}>Submitted {new Date(submission.submittedAt.replace(" ", "T") + "Z").toLocaleString()}</div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={onEdit}>Edit & resubmit</button>
    </div>
  );
}
