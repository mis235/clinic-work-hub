import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { STATUS, effectiveStatus } from "../constants.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import PunchCard from "../components/PunchCard.jsx";
import DocumentsPage from "./DocumentsPage.jsx";
import LearningPage from "./LearningPage.jsx";
import ConnectedToolPage from "./ConnectedToolPage.jsx";
import PoliciesPage from "./PoliciesPage.jsx";
import TrackerPage from "./TrackerPage.jsx";
import AssistantPage from "./AssistantPage.jsx";
import ShiftChecklistPage from "./ShiftChecklistPage.jsx";
import StaffProfilePage from "./StaffProfilePage.jsx";
import ChangePinModal from "../components/ChangePinModal.jsx";
import Icon from "../components/Icon.jsx";
import { navItemsFor } from "../navItems.js";

const firstName = (n = "") => n.split(/\s+/).find((w) => !/^dr\.?$/i.test(w)) || n;

export default function StaffDashboard({ user, onLogout }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [view, setView] = useState("checklist"); // 'checklist' | 'tracker' | 'shiftchecklist' | 'assistant' | 'policies'
  const [shiftToday, setShiftToday] = useState([]);
  const [pinModal, setPinModal] = useState(false);

  const refresh = useCallback(async () => {
    setTasks(await api.listTasks());
    api.getShiftChecklistToday().then(setShiftToday).catch(() => setShiftToday([]));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  async function setStatus(taskId, status) {
    await api.setStatus(taskId, status);
    refresh();
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const shiftSummary = [...shiftToday].sort((x, y) => (y.status === "in_progress") - (x.status === "in_progress"))[0] || null;
  const NAV_ITEMS = navItemsFor(user);
  const ACTIVE_LABEL = { checklist: "My checklist", shiftchecklist: "Shift Checklist", tracker: "Tracker", profile: "My Profile", assistant: "Assistant", policies: "Policies", documents: "Documents", learning: "Learning", clinicassistant: "Clinic Assistant" };
  const VIEW_FOR_LABEL = { "My checklist": "checklist", "Shift Checklist": "shiftchecklist", "Tracker": "tracker", "My Profile": "profile", "Assistant": "assistant", "Policies": "policies", "Documents": "documents", "Learning": "learning", "Clinic Assistant": "clinicassistant" };

  return (
    <div className="app-shell">
      <Sidebar
        items={NAV_ITEMS}
        active={ACTIVE_LABEL[view]}
        onSelect={(item) => setView(VIEW_FOR_LABEL[item] || "checklist")}
        who={`${user.name} · ${user.department}`}
        onLogout={onLogout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main className="main" style={{ maxWidth: 760 }}>
        <MobileTopBar title={ACTIVE_LABEL[view]} onOpenMenu={() => setMobileOpen(true)} />
        {view === "policies" ? (
          <PoliciesPage user={user} isStaffLayout />
        ) : view === "tracker" ? (
          <TrackerPage user={user} isStaffLayout />
        ) : view === "profile" ? (
          <StaffProfilePage user={user} staffId="me" isStaffLayout />
        ) : view === "shiftchecklist" ? (
          <ShiftChecklistPage user={user} isStaffLayout />
        ) : view === "documents" ? (
          <DocumentsPage user={user} isStaffLayout />
        ) : view === "clinicassistant" ? (
          <ConnectedToolPage toolKey="assistant" user={user} isStaffLayout />
        ) : view === "learning" ? (
          <LearningPage user={user} isStaffLayout />
        ) : view === "assistant" ? (
          <AssistantPage user={user} isStaffLayout />
        ) : (
          <>
        <div className="hero">
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.8, marginBottom: 8 }}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h2>{new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {firstName(user.name)}</h2>
            <p>{user.department}{user.designation ? ` · ${user.designation}` : ""}. You have <strong>{open.length}</strong> open task{open.length === 1 ? "" : "s"}{shiftSummary ? <> and your {shiftSummary.shift.toLowerCase()} checklist is <strong>{shiftSummary.status === "submitted" ? "submitted" : `${shiftSummary.completionPct}% done`}</strong>.</> : "."}</p>
            <div className="hero-actions">
              <button className="btn btn-light" onClick={() => setView("shiftchecklist")}><Icon name="clipboard" size={16} /> {shiftSummary && shiftSummary.status !== "submitted" ? "Continue checklist" : "Open shift checklist"}</button>
              <button className="btn btn-outline" onClick={() => setPinModal(true)}><Icon name="key" size={16} /> Change PIN</button>
            </div>
          </div>
        </div>

        <PunchCard />

        {loading && <div className="empty">Loading…</div>}

        {!loading && (
          <>
            <div className="section-head"><h2>Open tasks ({open.length})</h2></div>
            {open.length === 0 && <div className="empty">Nothing pending — nice work.</div>}
            {open.map((t) => <TaskCard key={t.id} task={t} onSet={setStatus} />)}

            {done.length > 0 && (
              <>
                <div className="section-head"><h2>Completed ({done.length})</h2></div>
                {done.map((t) => <TaskCard key={t.id} task={t} onSet={setStatus} />)}
              </>
            )}
          </>
        )}
          </>
        )}
        {pinModal && <ChangePinModal onClose={() => setPinModal(false)} onDone={() => setPinModal(false)} />}
      </main>
    </div>
  );
}

function TaskCard({ task, onSet }) {
  const st = STATUS[effectiveStatus(task)];
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="title" style={{ fontSize: 14 }}>{task.title}</div>
          <div className="meta">{task.category}{task.due_date ? ` · due ${new Date(task.due_date).toLocaleString()}` : ""}</div>
          {task.notes && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 6 }}>{task.notes}</div>}
        </div>
        <span className={`badge ${st.cls}`}>{st.label}</span>
      </div>
      {task.status !== "done" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-sm" onClick={() => onSet(task.id, "accepted")}>Accept</button>
          <button className="btn btn-outline btn-sm" onClick={() => onSet(task.id, "in_progress")}>Start</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSet(task.id, "done")}><Icon name="check" size={14} strokeWidth={3} /> Done</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onSet(task.id, "extension_requested")}>Request extension</button>
          <button className="btn btn-danger btn-sm" onClick={() => onSet(task.id, "issue_reported")}>Report issue</button>
        </div>
      )}
    </div>
  );
}
