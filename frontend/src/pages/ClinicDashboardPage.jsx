import { useEffect, useState } from "react";
import { api } from "../api.js";
import PageShell from "../components/PageShell.jsx";
import ChecklistDashboard from "../components/ChecklistDashboard.jsx";

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
  const sum = (k) => (depts || []).reduce((a, d) => a + (d[k] || 0), 0);
  const trend = rep?.completionTrend || [];
  const max = Math.max(100, ...trend.map((t) => t.completion_pct || 0));

  return (
    <PageShell user={user} active="Dashboards" title="Clinic dashboards" onLogout={onLogout} onBack={onBack}>
      <div className="page-head row">
        <div><div className="eyebrow">Insights</div><h1>Clinic dashboard</h1><p>Live numbers from attendance, checklists, tasks, documents and fines. Last 30 days for work completion.</p></div>
      </div>
      <div className="pill-row">
        <button className={`pill ${tab === "checklist" ? "active" : ""}`} onClick={() => setTab("checklist")}>Checklist dashboard</button>
        {(user.role === "admin" || user.leadership) && <button className={`pill ${tab === "live" ? "active" : ""}`} onClick={() => setTab("live")}>Clinic overview</button>}
      </div>
      {tab === "checklist" && <ChecklistDashboard user={user} />}
      {tab === "live" && (!depts ? <div className="empty">Loading…</div> : (
        <>
          <div className="dept-grid tile-grid">
            <div className="dept-card"><div className="meta">In clinic today</div><div className="title" style={{ fontSize: 24 }}>{sum("present_today")}/{sum("staff")}</div></div>
            <div className="dept-card"><div className="meta">Work completed</div><div className="title" style={{ fontSize: 24 }}>{pctText(rep?.completion?.overall_pct)}</div></div>
            <div className="dept-card"><div className="meta">Open tasks</div><div className="title" style={{ fontSize: 24 }}>{sum("tasks_open")}</div></div>
            <div className="dept-card"><div className="meta">Documents</div><div className="title" style={{ fontSize: 24 }}>{sum("documents")}</div></div>
            <div className="dept-card"><div className="meta">Fines this month</div><div className="title" style={{ fontSize: 24 }}>{rupee(sum("fines_month"))}</div></div>
          </div>

          {trend.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="title" style={{ marginBottom: 8 }}>Checklist completion by day</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
                {trend.slice(-30).map((t) => (
                  <div key={t.date} title={`${t.date}: ${t.completion_pct ?? 0}%`} style={{ flex: 1, background: "var(--primary)", borderRadius: 4, height: `${((t.completion_pct || 0) / max) * 100}%`, minHeight: 2 }} />
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="title" style={{ marginBottom: 6 }}>By department</div>
            <div style={{ overflowX: "auto" }}>
              <table className="reg-table" style={{ width: "100%" }}>
                <thead><tr><th style={{ textAlign: "left" }}>Department</th><th>Staff</th><th>In today</th><th>Work done</th><th>Open tasks</th><th>Docs</th><th>Fines</th></tr></thead>
                <tbody>{(depts || []).map((d) => (
                  <tr key={d.id}><td className="nm">{d.name}</td><td>{d.staff}</td><td>{d.present_today}</td><td>{pctText(d.completion_pct)}</td><td>{d.tasks_open}</td><td>{d.documents}</td><td>{d.fines_month ? rupee(d.fines_month) : ""}</td></tr>
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
