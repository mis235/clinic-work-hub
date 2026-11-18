import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import WorkspacePanel from "../components/WorkspacePanel.jsx";

const pctText = (p) => (p == null ? "—" : p + "%");
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Department portal: one card per department; open one to see its people, today's attendance, work completion, fines and documents.
export default function DepartmentsPage({ user, onLogout, onBack, onOpenProfile }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("workspace");
  const [msg, setMsg] = useState(""), [nameBox, setNameBox] = useState(null), [pick, setPick] = useState([]), [everyone, setEveryone] = useState([]);
  const isAdmin = user.role === "admin";
  const loadRows = () => api.portalDepartments().then((d) => setRows(d.rows)).catch(() => setRows([]));
  const loadDetail = (id) => api.portalDepartment(id).then(setDetail).catch(() => {});
  useEffect(() => { loadRows(); }, []);
  useEffect(() => { if (isAdmin && open) api.listRosterAll().then((l) => setEveryone((l || []).filter((u) => u.active !== 0 && u.active !== false).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}); }, [open]);
  const say = (m) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  async function saveName() {
    try {
      if (nameBox.id) { await api.renameDepartment(nameBox.id, nameBox.name); loadDetail(nameBox.id); } else await api.addDepartment(nameBox.name);
      setNameBox(null); loadRows(); say("Saved.");
    } catch (e) { say(e.message); }
  }
  async function removeDept() {
    if (!confirm(`Delete the department "${detail.department.name}"?`)) return;
    try { await api.deleteDepartment(open); setOpen(null); loadRows(); say("Department deleted."); } catch (e) { say(e.message); }
  }
  async function addPeople() {
    try { const r = await api.moveToDepartment(open, pick); setPick([]); loadDetail(open); loadRows(); say(`${r.moved} added to ${detail.department.name}.`); } catch (e) { say(e.message); }
  }
  useEffect(() => { if (open) { setDetail(null); setTab("workspace"); api.portalDepartment(open).then(setDetail).catch(() => setDetail({ people: [], documents: [], stats: {}, department: { name: "" } })); } }, [open]);

  return (
    <PageShell user={user} active="Departments" title="Departments" onLogout={onLogout} onBack={onBack}>
      <div className="page-head">
        <div className="eyebrow">People</div>
        <h1>{open && detail ? detail.department.name : "Department portal"}</h1>
        {isAdmin && (
          <div className="dept-tools">
            {!open && <button className="btn btn-primary btn-sm" onClick={() => setNameBox({ name: "" })}><Icon name="plus" size={14} /> Add department</button>}
            {open && detail && <><button className="btn btn-ghost btn-sm" onClick={() => setNameBox({ id: open, name: detail.department.name })}><Icon name="pencil" size={14} /> Rename</button>
              <button className="btn btn-ghost btn-sm" onClick={removeDept}>Delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(null); loadRows(); }}><Icon name="back" size={14} /> All departments</button></>}
          </div>)}
      </div>
      {msg && <div className="note">{msg}</div>}
      {nameBox && (
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input className="field" style={{ flex: "1 1 240px" }} autoFocus placeholder="Department name, e.g. Admin" value={nameBox.name} onChange={(e) => setNameBox({ ...nameBox, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveName()} />
          <button className="btn btn-primary btn-sm" onClick={saveName}>{nameBox.id ? "Save name" : "Add"}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setNameBox(null)}>Cancel</button>
        </div>)}

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

      {open && (
        <div className="pill-row">
          <button className={`pill ${tab === "workspace" ? "active" : ""}`} onClick={() => setTab("workspace")}>Workspace</button>
          <button className={`pill ${tab === "people" ? "active" : ""}`} onClick={() => setTab("people")}>People & work</button>
          <button className={`pill ${tab === "docs" ? "active" : ""}`} onClick={() => setTab("docs")}>Documents</button>
        </div>
      )}
      {open && tab === "workspace" && <WorkspacePanel deptId={open} />}

      {open && tab !== "workspace" && (!detail ? <div className="empty">Loading…</div> : (
        <>
          {tab === "people" && isAdmin && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="title" style={{ marginBottom: 6 }}>Add people to {detail.department.name}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select className="field" style={{ flex: "1 1 260px" }} value="" onChange={(e) => e.target.value && setPick((p) => [...new Set([...p, e.target.value])])}>
                  <option value="">Choose staff…</option>
                  {everyone.filter((u) => !pick.includes(u.id) && !(detail.people || []).some((p) => p.id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!pick.length} onClick={addPeople}>Add {pick.length || ""} to department</button>
              </div>
              {pick.length > 0 && <div className="pill-row" style={{ marginTop: 8 }}>{pick.map((id) => <button key={id} className="pill" onClick={() => setPick(pick.filter((x) => x !== id))}>{everyone.find((u) => u.id === id)?.name} ×</button>)}</div>}
            </div>)}
          {tab === "people" && <div className="card" style={{ marginBottom: 16 }}>
            <div className="title" style={{ marginBottom: 6 }}>People (work done = last 30 days)</div>
            {detail.people.map((p) => (
              <div key={p.id} className="task-row" style={{ cursor: "pointer" }} onClick={() => onOpenProfile?.(p.id)}>
                <div><div className="title">{p.name}</div><div className="meta">{p.designation || "—"}</div></div>
                <div className="right" style={{ gap: 8 }}>
                  <span className={`badge ${p.today_mark === "P" ? "done" : p.today_mark ? "accepted" : "sent"}`}>{p.today_label || "Not marked"}</span>
                  <span className="badge accepted">Work {pctText(p.completion_pct)}</span>
                  {p.fines_month > 0 && <span className="badge overdue">Fine {rupee(p.fines_month)}</span>}
                </div>
              </div>
            ))}
          </div>}
          {tab === "docs" && <div className="card">
            <div className="title" style={{ marginBottom: 6 }}>Documents Uploaded by This Department</div>
            {detail.documents.length === 0 && <div className="empty">Nothing uploaded yet. Staff can add their work documents from the Documents page.</div>}
            {detail.documents.map((d) => (
              <div key={d.id} className="task-row" style={{ cursor: "pointer" }} onClick={() => (d.kind === "link" ? window.open(d.url, "_blank", "noopener") : api.downloadDocument(d.id, d.file_name))}>
                <div><div className="title" style={{ color: "var(--primary)" }}>{d.title}</div><div className="meta">{d.category || "General"} · {d.uploaded_by_name || "—"} · {d.created_at?.slice(0, 10)}</div></div>
              </div>
            ))}
          </div>}
        </>
      ))}
    </PageShell>
  );
}
