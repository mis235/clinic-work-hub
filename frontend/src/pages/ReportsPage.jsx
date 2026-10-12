import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

export default function ReportsPage({ user, onLogout, onBack }) {
  const [report, setReport] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => { api.getReports(days).then(setReport).catch(() => setReport({})); }, [days]);
  const bar = (pct) => <div className="progress" style={{ width: 140 }}><span style={{ width: `${pct || 0}%` }} /></div>;

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
            <div className="pill-row" style={{ marginTop: 4 }}>
              {[7, 30, 90].map((d) => <button key={d} className={`pill ${days === d ? "active" : ""}`} onClick={() => setDays(d)}>Last {d} days</button>)}
            </div>
            <h2 style={{ fontSize: 16, margin: "8px 0 10px" }}>Overall work completion — {report.completion?.overall_pct == null ? "no data yet" : `${report.completion.overall_pct}%`}</h2>
            <div className="meta" style={{ marginBottom: 10 }}>Counts every shift-checklist item (including imported history) plus every task an admin assigned.</div>
            <div className="card">
              {(report.completionByDept || []).length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nothing recorded in this period.</div>}
              {(report.completionByDept || []).map((d) => (
                <div key={d.department} className="task-row">
                  <div><div className="title">{d.department}</div><div className="meta">{d.combined_done}/{d.combined_total} items & tasks · {d.submissions} checklists · {d.tasks_total} tasks</div></div>
                  <div className="right" style={{ gap: 10 }}>{bar(d.completion_pct)}<strong style={{ minWidth: 40, textAlign: "right" }}>{d.completion_pct ?? "—"}%</strong></div>
                </div>
              ))}
            </div>
            <h2 style={{ fontSize: 16, margin: "20px 0 10px" }}>By person</h2>
            <div className="card">
              {(report.completionByStaff || []).map((p) => (
                <div key={p.user_id} className="task-row">
                  <div><div className="title">{p.name}</div><div className="meta">{p.department || "—"} · {p.submissions} checklists · {p.tasks_done}/{p.tasks_total} tasks</div></div>
                  <div className="right" style={{ gap: 10 }}>{bar(p.completion_pct)}<strong style={{ minWidth: 40, textAlign: "right" }}>{p.completion_pct ?? "—"}%</strong></div>
                </div>
              ))}
            </div>
            <h2 style={{ fontSize: 16, margin: "24px 0 10px" }}>Task completion by department</h2>
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
