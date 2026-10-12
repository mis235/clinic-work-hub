import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function ReportsPage({ user, onLogout, onBack }) {
  const [report, setReport] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { api.getReports().then(setReport).catch(() => setReport({})); }, []);

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Reports"
        onSelect={(item) => item !== "Reports" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Reports" onOpenMenu={() => setMobileOpen(true)} />
        <div className="page-head">
          <h1>Reports & Insights</h1>
          <p>Built entirely from live data — task completion, attendance, and policy sign-off.</p>
        </div>

        {!report ? <div className="empty">Loading…</div> : (
          <>
            <h2 style={{ fontSize: 16, margin: "20px 0 10px" }}>Task completion by department</h2>
            <div className="card">
              {(report.taskByDept || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No tasks recorded yet.</div>}
              {(report.taskByDept || []).map((d, i) => (
                <div key={i} className="task-row">
                  <div className="title">{d.department || "Unassigned"}</div>
                  <div className="right">
                    <span style={{ fontSize: 12.5 }}>{d.done}/{d.total} done</span>
                    {d.overdue > 0 && <span className="badge overdue">{d.overdue} overdue</span>}
                  </div>
                </div>
              ))}
            </div>

            <h2 style={{ fontSize: 16, margin: "24px 0 10px" }}>Attendance — last 30 days</h2>
            <div className="card">
              {(report.attendanceSummary || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No attendance recorded yet.</div>}
              {(report.attendanceSummary || []).map((a, i) => (
                <div key={i} className="task-row">
                  <div>
                    <div className="title">{a.name}</div>
                    <div className="meta">{a.department}</div>
                  </div>
                  <div style={{ fontSize: 12.5 }}>{a.check_ins} check-ins{a.manual_entries > 0 ? ` · ${a.manual_entries} manual` : ""}</div>
                </div>
              ))}
            </div>

            <h2 style={{ fontSize: 16, margin: "24px 0 10px" }}>Policy sign-off gaps</h2>
            <div className="card">
              {(report.policyGaps || []).map((p, i) => (
                <div key={i} className="task-row">
                  <div className="title">{p.title} <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>v{p.version}</span></div>
                  {p.missingCount === 0 ? (
                    <span className="badge done">Everyone's acknowledged</span>
                  ) : (
                    <span className="badge overdue" title={p.missing.join(", ")}>{p.missingCount} haven't read it</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
