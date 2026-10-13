import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";

const fmtTime = (t) => (t ? new Date(t.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
const pctText = (p) => (p == null ? "—" : p + "%");
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Department portal: one card per department; open one to see its people, today's attendance, work completion, fines and documents.
export default function DepartmentsPage({ user, onLogout, onBack, onOpenProfile }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => { api.portalDepartments().then((d) => setRows(d.rows)).catch(() => setRows([])); }, []);
  useEffect(() => { if (open) { setDetail(null); api.portalDepartment(open).then(setDetail).catch(() => setDetail({ people: [], documents: [], stats: {}, department: { name: "" } })); } }, [open]);

  return (
    <PageShell user={user} active="Departments" title="Departments" onLogout={onLogout} onBack={onBack}>
      <div className="page-head">
        <div className="eyebrow">People</div>
        <h1>{open && detail ? detail.department.name : "Department portal"}</h1>
        <p>{open ? <button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>← All departments</button> : "Each department's attendance, work completion, fines and uploaded documents in one place."}</p>
      </div>

      {!open && (!rows ? <div className="empty">Loading…</div> : (
        <div className="dept-grid">
          {rows.map((d) => (
            <button key={d.id} className="dept-card" onClick={() => setOpen(d.id)}>
              <div className="title">{d.name}</div>
              <div className="nums">
                <span>Staff <b>{d.staff}</b></span><span>In today <b>{d.present_today}/{d.staff}</b></span>
                <span>Work done <b>{pctText(d.completion_pct)}</b></span><span>Open tasks <b>{d.tasks_open}</b></span>
                <span>Documents <b>{d.documents}</b></span><span>Fines (month) <b>{rupee(d.fines_month)}</b></span>
              </div>
            </button>
          ))}
        </div>
      ))}

      {open && (!detail ? <div className="empty">Loading…</div> : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="title" style={{ marginBottom: 6 }}>People (work done = last 30 days)</div>
            {detail.people.map((p) => (
              <div key={p.id} className="task-row" style={{ cursor: "pointer" }} onClick={() => onOpenProfile?.(p.id)}>
                <div><div className="title">{p.name}</div><div className="meta">{p.designation || "—"} · In today: {fmtTime(p.first_in)}</div></div>
                <div className="right" style={{ gap: 8 }}>
                  <span className={`badge ${p.first_in ? "done" : "overdue"}`}>{p.first_in ? "In" : "Not in"}</span>
                  <span className="badge accepted">Work {pctText(p.completion_pct)}</span>
                  {p.fines_month > 0 && <span className="badge overdue">Fine {rupee(p.fines_month)}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="title" style={{ marginBottom: 6 }}>Documents uploaded by this department</div>
            {detail.documents.length === 0 && <div className="empty">Nothing uploaded yet. Staff can add their work documents from the Documents page.</div>}
            {detail.documents.map((d) => (
              <div key={d.id} className="task-row">
                <div><div className="title">{d.title}</div><div className="meta">{d.category || "General"} · {d.uploaded_by_name || "—"} · {d.created_at?.slice(0, 10)}</div></div>
                {d.kind === "link"
                  ? <a className="btn btn-ghost btn-sm" href={d.url} target="_blank" rel="noreferrer">Open</a>
                  : <button className="btn btn-ghost btn-sm" onClick={() => api.downloadDocument(d.id, d.file_name)}>Download</button>}
              </div>
            ))}
          </div>
        </>
      ))}
    </PageShell>
  );
}
