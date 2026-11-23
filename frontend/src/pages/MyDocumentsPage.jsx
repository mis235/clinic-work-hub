import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import MyPayslips from "../components/MyPayslips.jsx";

const fmtSize = (n) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

// The staff member's own page: every paper the clinic holds for them, each with a Download button.
// Papers that are not on file yet are listed at the bottom so the person knows what to hand in.
export default function MyDocumentsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.listStaffFiles("me").then(setData).catch((e) => setErr(e.message)); }, []);

  const get = (r) => (r.offer ? api.downloadMyOfferLetter(r.id, r.file_name) : api.downloadDocument(r.id, r.file_name)).catch((x) => setErr(x.message));

  if (!data) return <div style={{ marginTop: 8 }}>{err ? <div className="login-error">{err}</div> : <div className="empty">Loading…</div>}</div>;

  const offers = (data.offerLetters || []).map((o) => ({ id: o.id, file_name: o.file_name, created_at: o.created_at, offer: true }));
  const filesOf = (key) => data.files.filter((f) => f.doc_type === key);
  // Required papers. The offer letter can sit in HR (generated) or as an uploaded file.
  const papers = data.types.map((t) => ({ ...t, rows: t.key === "offer_signed" ? [...offers, ...filesOf(t.key)] : filesOf(t.key) }));
  const missing = papers.filter((p) => !p.rows.length);
  const records = (data.recordTypes || []).map((t) => ({ ...t, rows: filesOf(t.key) })).filter((t) => t.rows.length);
  const total = papers.reduce((n, p) => n + p.rows.length, 0) + records.reduce((n, p) => n + p.rows.length, 0);

  return (
    <div style={{ marginTop: 8 }}>
      <div className="page-head">
        <div className="eyebrow">My documents</div>
        <h1>Your papers at the clinic</h1>
        <p>{total ? "Tap Download to save a copy to your phone." : "Nothing has been added yet."} {missing.length ? `${missing.length} paper${missing.length > 1 ? "s" : ""} still to give to the clinic office.` : "All required papers are on file."}</p>
      </div>
      {err && <div className="login-error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="name">Required papers</div></div>
        {papers.map((p) => (
          <div key={p.key} className="task-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, minWidth: 220 }}>
              <div className={`kpi-ico ${p.rows.length ? "green" : "amber"}`} style={{ width: 32, height: 32 }}><Icon name={p.rows.length ? "check" : "file"} size={15} /></div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.label}</div>
            </div>
            {p.rows.length === 0 ? <span className="badge in_progress">Not received yet</span> : (
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                {p.rows.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="meta" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.file_name}{r.size ? ` · ${fmtSize(r.size)}` : ""}</span>
                    <button className="btn btn-outline btn-sm" onClick={() => get(r)}>Download</button>
                  </div>
                ))}
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
          <div className="meta" style={{ marginBottom: 6 }}>A clear photo or PDF is fine.</div>
          {missing.map((p) => <div key={p.key} className="task-row" style={{ border: 0, padding: "4px 0" }}><span style={{ fontSize: 13.5 }}>• {p.label}</span></div>)}
        </div>
      )}
    </div>
  );
}
