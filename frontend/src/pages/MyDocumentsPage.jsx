import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import MyPayslips from "../components/MyPayslips.jsx";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import { navItemsFor } from "../navItems.js";

const fmtSize = (n) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

// The staff member's own page: every paper the clinic holds for them, each with a Download button.
// Papers that are not on file yet are listed at the bottom so the person knows what to hand in.
export default function MyDocumentsPage({ user, onLogout, onBack } = {}) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(""), [ok, setOk] = useState(""), [busy, setBusy] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const load = () => api.listStaffFiles("me").then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function upload(docType, label, file) {
    if (!file) return; setErr(""); setOk(""); setBusy(docType);
    try { const fd = new FormData(); fd.append("file", file); fd.append("docType", docType); await api.addStaffFile("me", fd); setOk(`${label} uploaded. The clinic office has been told.`); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  const UploadBtn = ({ p, again }) => (
    <label className={`btn ${again ? "btn-ghost" : "btn-primary"} btn-sm`} style={{ cursor: "pointer", opacity: busy === p.key ? 0.6 : 1 }}>
      {busy === p.key ? "Uploading…" : again ? "Add another" : "Upload"}
      <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} disabled={!!busy} onChange={(e) => { upload(p.key, p.label, e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );

  const get = (r) => (r.offer ? api.downloadMyOfferLetter(r.id, r.file_name) : api.downloadDocument(r.id, r.file_name)).catch((x) => setErr(x.message));

  const wrap = (body) => onBack ? (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="My Documents" onSelect={(item) => item !== "My Documents" && onBack(item)} who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main"><MobileTopBar title="My Documents" onOpenMenu={() => setMobileOpen(true)} />{body}</div>
    </div>
  ) : body;
  if (!data) return wrap(<div style={{ marginTop: 8 }}>{err ? <div className="login-error">{err}</div> : <div className="empty">Loading…</div>}</div>);

  const offers = (data.offerLetters || []).map((o) => ({ id: o.id, file_name: o.file_name, created_at: o.created_at, offer: true }));
  const filesOf = (key) => data.files.filter((f) => f.doc_type === key);
  // Required papers. The offer letter can sit in HR (generated) or as an uploaded file.
  const papers = data.types.map((t) => ({ ...t, rows: t.key === "offer_signed" ? [...offers, ...filesOf(t.key)] : filesOf(t.key) }));
  const missing = papers.filter((p) => !p.rows.length);
  const records = (data.recordTypes || []).map((t) => ({ ...t, rows: filesOf(t.key) })).filter((t) => t.rows.length);
  const total = papers.reduce((n, p) => n + p.rows.length, 0) + records.reduce((n, p) => n + p.rows.length, 0);

  return wrap(
    <div style={{ marginTop: 8 }}>
      <div className="page-head">
        <div className="eyebrow">My documents</div>
        <h1>Your papers at the clinic</h1>
        <p>{!total ? "Nothing has been added yet. " : ""}{missing.length ? `${missing.length} paper${missing.length > 1 ? "s" : ""} still to give to the clinic office.` : "All required papers are on file."}</p>
      </div>
      {err && <div className="login-error" style={{ marginBottom: 12 }}>{err}</div>}
      {ok && <div className="note" style={{ marginBottom: 12 }}>{ok}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="name">Required papers</div></div>
        {papers.map((p) => (
          <div key={p.key} className="task-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 220 }}>
              <div className={`kpi-ico ${p.rows.length ? "green" : "amber"}`} style={{ width: 32, height: 32 }}><Icon name={p.rows.length ? "check" : "file"} size={15} /></div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.label}</div>
            </div>
            {p.rows.length === 0 ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="badge in_progress">Not received yet</span>{p.key !== "offer_signed" && <UploadBtn p={p} />}</div> : (
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                {p.rows.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="meta" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.file_name}{r.size ? ` · ${fmtSize(r.size)}` : ""}</span>
                    <button className="btn btn-outline btn-sm" onClick={() => get(r)}>Download</button>
                  </div>
                ))}
                {p.key !== "offer_signed" && <UploadBtn p={p} again />}
              </div>
            )}
          </div>
        ))}
      </div>

      {records.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><div className="name">Letters &amp; records</div></div>
          {records.map((t) => t.rows.map((r) => (
            <div key={r.id} className="task-row" style={{ alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}><div className="title">{t.label}</div><div className="meta">{r.file_name}{r.size ? ` · ${fmtSize(r.size)}` : ""}{r.created_at ? ` · ${fmtDate(r.created_at)}` : ""}</div></div>
              <button className="btn btn-outline btn-sm" onClick={() => get(r)}>Download</button>
            </div>
          )))}
        </div>
      )}

      <MyPayslips />

      {missing.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><div className="name">Please give these to the clinic office</div></div>
          <div className="meta" style={{ marginBottom: 6 }}>Tap <b>Upload</b> next to each paper above and choose a clear photo or PDF. You can also hand them to the clinic office.</div>
          {missing.map((p) => <div key={p.key} className="task-row" style={{ border: 0, padding: "4px 0" }}><span style={{ fontSize: 13.5 }}>• {p.label}</span></div>)}
        </div>
      )}
    </div>
  );
}
