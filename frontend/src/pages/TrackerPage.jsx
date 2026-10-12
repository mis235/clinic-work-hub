import { useEffect, useState } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";

const EVENT_LABEL = {
  created: "Assigned",
  sent_whatsapp: "Sent on WhatsApp",
  status_changed: "Status updated",
  send_failed: "WhatsApp send failed",
};

export default function TrackerPage({ user, isStaffLayout, onLogout, onBack }) {
  const [summary, setSummary] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = () => api.getMySummary().then(setSummary).catch(() => setSummary(null));
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000); // confirms this is live, not a static mock
    return () => clearInterval(id);
  }, []);

  const body = (
    <>
      <div className="page-head">
        <h1>Procedure Tracker</h1>
        <p>A live view of your own progress — tasks, attendance, and policy status, updated as you work.</p>
      </div>

      {!summary && <div className="empty">Loading…</div>}

      {summary && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat-card done">
              <div className="num">{summary.tasks.completionRate === null ? "—" : `${summary.tasks.completionRate}%`}</div>
              <div className="lbl">TASK COMPLETION</div>
            </div>
            <div className="stat-card sent">
              <div className="num">{summary.tasks.open}</div>
              <div className="lbl">OPEN TASKS</div>
            </div>
            <div className="stat-card overdue">
              <div className="num">{summary.tasks.overdue}</div>
              <div className="lbl">OVERDUE</div>
            </div>
            <div className="stat-card in_progress">
              <div className="num">{summary.attendance.daysPresentLast30}</div>
              <div className="lbl">DAYS PRESENT (30D)</div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="title" style={{ fontSize: 14, fontWeight: 700 }}>Today's attendance</div>
              <div className="meta">{summary.attendance.checkedInToday ? "You're checked in for today." : "Not checked in yet today."}</div>
            </div>
            <span className={`badge ${summary.attendance.checkedInToday ? "done" : "pending"}`}>
              {summary.attendance.checkedInToday ? "Checked in" : "Pending"}
            </span>
          </div>

          {summary.policiesPending > 0 && (
            <div className="note">
              {summary.policiesPending} {summary.policiesPending === 1 ? "policy needs" : "policies need"} your acknowledgment — open the Policies tab.
            </div>
          )}

          <h2 style={{ fontSize: 14, margin: "20px 0 10px" }}>Recent activity</h2>
          {summary.timeline.length === 0 && <div className="empty">Nothing logged yet.</div>}
          {summary.timeline.map((e, i) => (
            <div key={i} className="task-row">
              <div>
                <div className="title">{e.title}</div>
                <div className="meta">{EVENT_LABEL[e.event] || e.event}{e.detail ? ` — ${e.detail}` : ""} · {e.channel}</div>
              </div>
              <div className="meta" style={{ flexShrink: 0 }}>{new Date(e.created_at).toLocaleString()}</div>
            </div>
          ))}
        </>
      )}
    </>
  );

  if (isStaffLayout) return <div style={{ marginTop: 8 }}>{body}</div>;

  return (
    <div className="app-shell">
      <Sidebar items={navItemsFor(user)} active="Tracker"
        onSelect={(item) => item !== "Tracker" && onBack(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`} onLogout={onLogout}
        mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="main">
        <MobileTopBar title="Tracker" onOpenMenu={() => setMobileOpen(true)} />
        {body}
      </div>
    </div>
  );
}
