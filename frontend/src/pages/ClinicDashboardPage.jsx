import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import ChecklistDashboard from "../components/ChecklistDashboard.jsx";
import ClinicAIPage from "./ClinicAIPage.jsx";
import Icon from "../components/Icon.jsx";

const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const pctText = (p) => (p == null ? "—" : p + "%");

// Live clinic dashboard built from the app's own data (no outside link needed).
export default function ClinicDashboardPage({ user, onLogout, onBack, onNavigate }) {
  const [depts, setDepts] = useState(null);
  const [rep, setRep] = useState(null);
  const [tab, setTab] = useState("checklist");
  useEffect(() => {
    const load = () => {
      if (!(user.role === "admin" || user.leadership)) return;
      api.portalDepartments().then((d) => setDepts(d.rows)).catch(() => setDepts((x) => x || []));
      api.getReports(30).then(setRep).catch(() => setRep((x) => x || {}));
    };
    load();
    const t = setInterval(load, 30000);   // numbers refresh by themselves
    return () => clearInterval(t);
  }, []);
  const lead = user.role === "admin" || !!user.leadership;
  const sum = (k) => (depts || []).reduce((a, d) => a + (d[k] || 0), 0);
  const trend = rep?.completionTrend || [];
  const max = Math.max(100, ...trend.map((t) => t.completion_pct || 0));

  return (
    <PageShell user={user} active="Dashboards" title="Clinic dashboards" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Insights</div><h1>Clinic Dashboard</h1><p>Checklists, patients and clinic numbers in one place. They update by themselves when staff submit their work.</p></div>
        <div className="live-chip"><span className="live-dot" /> Live · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <div className="pill-row dash-tabs">
        {[["checklist", "Checklists", "tasks", true], ["live", "Clinic Overview", "chart", lead], ["patients", "Patients", "users", lead], ["chat", "Ask Lumi", "bot", lead]].filter((t) => t[3]).map(([k, label, icon]) => (
          <button key={k} className={`pill ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}><Icon name={icon} size={15} /> {label}</button>
        ))}
      </div>
      {tab === "checklist" && <ChecklistDashboard user={user} />}
      {tab === "patients" && <PatientDashboard user={user} />}
      {tab === "chat" && <ClinicAIPage user={user} isStaffLayout />}
      {tab === "live" && (!depts ? <div className="empty">Loading…</div> : (
        <>
          <div className="kpi-row">
            {[["users", "In clinic today", `${sum("present_today")}/${sum("staff")}`, "#c42f8f"], ["check", "Work completed", pctText(rep?.completion?.overall_pct), "#12a56f"], ["tasks", "Open tasks", sum("tasks_open"), "#e0a020"], ["file", "Documents", sum("documents"), "#5b7be0"], ["wallet", "Fines this month", rupee(sum("fines_month")), "#d64545"]].map(([ic, l, v, c]) => (
              <div key={l} className="kpi" style={{ "--kc": c }}><div className="kpi-ic"><Icon name={ic} size={18} /></div><div className="meta">{l}</div><div className="kpi-v">{v}</div></div>
            ))}
          </div>

          {trend.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="title" style={{ marginBottom: 8 }}>Checklist Completion by Day</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
                {trend.slice(-30).map((t) => (
                  <div key={t.date} title={`${t.date}: ${t.completion_pct ?? 0}%`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div style={{ background: "linear-gradient(180deg, var(--primary), #8e5bd8)", borderRadius: 4, height: `${((t.completion_pct || 0) / max) * 100}%`, minHeight: 2 }} />
                    <div className="meta" style={{ fontSize: 9, textAlign: "center", marginTop: 3 }}>{String(t.date).slice(8)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="title" style={{ marginBottom: 6 }}>By Department</div>
            <div style={{ overflowX: "auto" }}>
              <table className="reg-table" style={{ width: "100%" }}>
                <thead><tr><th style={{ textAlign: "left" }}>Department</th><th>Staff</th><th>In today</th><th>Work done</th><th>Open tasks</th><th>Docs</th><th>Fines</th></tr></thead>
                <tbody>{(depts || []).map((d) => (
                  <tr key={d.id}><td className="nm">{d.name}</td><td>{d.staff}</td><td>{d.present_today}</td><td><span className="mini-bar"><span style={{ width: `${d.completion_pct || 0}%` }} /></span> {pctText(d.completion_pct)}</td><td>{d.tasks_open}</td><td>{d.documents}</td><td>{d.fines_month ? rupee(d.fines_month) : ""}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => onNavigate("Departments")}>Open department portal →</button></div>
          </div>
        </>
      ))}
    </PageShell>
  );
}

// The clinic's patient/procedure dashboard (an HTML file kept privately on the server).
function PatientDashboard({ user }) {
  const [src, setSrc] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const wrap = useRef(null);
  const [w, setW] = useState(1280);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 1280)); ro.observe(el); setW(el.clientWidth || 1280);
    return () => ro.disconnect();
  }, [src, full]);
  const auth = () => ({ Authorization: "Bearer " + localStorage.getItem("token") });
  const base = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");
  const load = async () => {
    try {
      const r = await fetch(base + "/api/clinic-ai/patient-dashboard", { headers: auth() });
      if (!r.ok) { setSrc(null); setMsg((await r.json().catch(() => ({}))).error || "Not available."); return; }
      const blob = await r.blob(); setSrc(URL.createObjectURL(blob)); setMsg("");
    } catch { setMsg("Could not load the dashboard."); }
  };
  useEffect(() => { load(); }, []);
  async function upload(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setMsg("Uploading… (a big file can take a minute)");
    try {
      const r = await fetch(base + "/api/clinic-ai/patient-dashboard", { method: "PUT", headers: { ...auth(), "Content-Type": "application/octet-stream" }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setMsg("Uploaded."); await load();
    } catch (err) { setMsg(err.message); }
    setBusy(false); e.target.value = "";
  }
  const box = full ? { position: "fixed", inset: 0, zIndex: 200, background: "#fff", padding: 10, display: "flex", flexDirection: "column" } : null;
  return (
    <div className="card" style={box || undefined}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setFull((f) => !f)}>{full ? "✕ Close full screen" : "⤢ Open full screen"}</button>
        {!full && <span className="meta">The dashboard fits the screen. Use full screen for a bigger view.</span>}
      </div>
      {user.role === "admin" && !full && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: "pointer" }}>{src ? "Replace dashboard file" : "Upload dashboard file"}
            <input type="file" accept=".html,text/html" onChange={upload} disabled={busy} style={{ display: "none" }} /></label>
          <span className="meta">The patient data stays on your server and is shown only to admin and leadership.</span>
        </div>)}
      {msg && <div className="meta" style={{ marginBottom: 8 }}>{msg}</div>}
      {src && (() => {
        const DESIGN = Math.max(900, w), scale = w / DESIGN, h = full ? Math.max(560, window.innerHeight - 80) : Math.max(560, window.innerHeight - 200);
        return (
          <div ref={wrap} style={{ width: "100%", height: h, overflow: "hidden", borderRadius: 12, flex: full ? 1 : undefined }}>
            <iframe title="Patient Dashboard" src={src} sandbox="allow-scripts"
              style={{ width: DESIGN, height: h / scale, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", display: "block", background: "#fff" }} />
          </div>);
      })()}
    </div>
  );
}
