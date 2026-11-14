import AskLumiBar from "../components/AskLumiBar.jsx";
import Lumi from "../components/Lumi.jsx";
import { useEffect, useState, useCallback } from "react";
import { api, assetUrl } from "../api.js";
import { STATUS, effectiveStatus } from "../constants.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import WorkspacePanel from "../components/WorkspacePanel.jsx";
import MyDayCard from "../components/MyDayCard.jsx";
import MyFinesCard from "../components/MyFinesCard.jsx";
import DocumentsPage from "./DocumentsPage.jsx";
import LearningPage from "./LearningPage.jsx";
import ConnectedToolPage from "./ConnectedToolPage.jsx";
import ClinicAIPage from "./ClinicAIPage.jsx";
import PoliciesPage from "./PoliciesPage.jsx";
import TrackerPage from "./TrackerPage.jsx";
import AssistantPage from "./AssistantPage.jsx";
import RoomsPage from "./RoomsPage.jsx";
import ShiftChecklistPage from "./ShiftChecklistPage.jsx";
import StaffProfilePage from "./StaffProfilePage.jsx";
import LeavePage from "./LeavePage.jsx";
import HrOverview from "../components/HrOverview.jsx";
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
    window.addEventListener("hub-refresh", refresh);
    return () => { clearInterval(id); window.removeEventListener("hub-refresh", refresh); };
  }, [refresh]);

  async function setStatus(taskId, status) {
    await api.setStatus(taskId, status);
    refresh();
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const shiftSummary = [...shiftToday].sort((x, y) => (y.status === "in_progress") - (x.status === "in_progress"))[0] || null;
  const NAV_ITEMS = navItemsFor(user);
  const ACTIVE_LABEL = { checklist: "My checklist", shiftchecklist: "Shift Checklist", rooms: "Procedure Rooms", tracker: "Tracker", profile: "My Profile", leave: "Leave", workspace: "My Workspace", assistant: "Assistant", policies: "Policies", sops: "SOPs", documents: "Documents", learning: "Learning", clinicassistant: "Clinic Assistant" };
  const VIEW_FOR_LABEL = { "My checklist": "checklist", "Shift Checklist": "shiftchecklist", "Procedure Rooms": "rooms", "Tracker": "tracker", "My Profile": "profile", "Leave": "leave", "My Workspace": "workspace", "Assistant": "assistant", "Policies": "policies", "SOPs": "sops", "Documents": "documents", "Learning": "learning", "Clinic Assistant": "clinicassistant" };

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
        {view === "sops" ? (
          <PoliciesPage user={user} mode="sops" isStaffLayout />
        ) : view === "policies" ? (
          <PoliciesPage user={user} isStaffLayout />
        ) : view === "tracker" ? (
          <TrackerPage user={user} isStaffLayout />
        ) : view === "leave" ? (
          <LeavePage user={user} isStaffLayout />
        ) : view === "profile" ? (
          <StaffProfilePage user={user} staffId="me" isStaffLayout />
        ) : view === "rooms" ? (
          <RoomsPage user={user} isStaffLayout />
        ) : view === "shiftchecklist" ? (
          <ShiftChecklistPage user={user} isStaffLayout />
        ) : view === "documents" ? (
          <DocumentsPage user={user} isStaffLayout />
        ) : view === "clinicassistant" ? (
          <ClinicAIPage user={user} isStaffLayout />
        ) : view === "learning" ? (
          <LearningPage user={user} isStaffLayout />
        ) : view === "workspace" ? (
          <WorkspacePanel deptId="me" title="My workspace" />
        ) : view === "assistant" ? (
          <AssistantPage user={user} isStaffLayout />
        ) : (
          <>
        <AskLumiBar />
        <div className="hero">
          <Lumi mood="wave" size={118} className="hero-lumi" />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.02em", opacity: 0.85, marginBottom: 8 }}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h2>{new Date().getHours() < 12 ? "Good Morning" : new Date().getHours() < 17 ? "Good Afternoon" : "Good Evening"}, {firstName(user.name)}</h2>
            <p>{user.department}{user.designation ? ` · ${user.designation}` : ""}. You have <strong>{open.length}</strong> open task{open.length === 1 ? "" : "s"}{shiftSummary ? <> and your {shiftSummary.shift.toLowerCase()} checklist is <strong>{shiftSummary.status === "submitted" ? "submitted" : `${shiftSummary.completionPct}% done`}</strong>.</> : "."}</p>
            <div className="hero-actions">
              <button className="btn btn-light" onClick={() => setView("shiftchecklist")}><Icon name="clipboard" size={16} /> {shiftSummary && shiftSummary.status !== "submitted" ? "Continue checklist" : "Open shift checklist"}</button>
              <button className="btn btn-outline" onClick={() => setPinModal(true)}><Icon name="key" size={16} /> Change PIN</button>
            </div>
          </div>
        </div>

        <MyDayCard onNavigate={setView} />
        <MyFinesCard />
        <HrOverview user={user} onNavigate={(k) => setView(VIEW_FOR_LABEL[k] || "checklist")} />

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
  const [asking, setAsking] = useState(false);   // "Done" asks for an optional photo first
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try { if (file) await api.taskProof(task.id, file); await onSet(task.id, "done"); setAsking(false); setFile(null); } finally { setBusy(false); }
  };
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
      {task.proof_photo && <a href={assetUrl(task.proof_photo)} target="_blank" rel="noreferrer"><img src={assetUrl(task.proof_photo)} alt="Proof" style={{ marginTop: 8, maxWidth: 140, maxHeight: 100, borderRadius: 8, border: "1px solid var(--line)" }} /></a>}
      {asking && task.status !== "done" && (
        <div style={{ marginTop: 12, padding: 12, background: "var(--bg-soft, #f6f7f9)", borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Add a photo of the finished work (optional)</div>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ margin: "8px 0", display: "block" }} />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={finish}>{busy ? "Saving…" : file ? "Mark Done With Photo" : "Mark Done Without Photo"}</button>{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => { setAsking(false); setFile(null); }}>Cancel</button>
        </div>
      )}
      {task.status !== "done" && !asking && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-sm" onClick={() => onSet(task.id, "accepted")}>Accept</button>
          <button className="btn btn-outline btn-sm" onClick={() => onSet(task.id, "in_progress")}>Start</button>
          <button className="btn btn-primary btn-sm" onClick={() => setAsking(true)}><Icon name="check" size={14} strokeWidth={3} /> Done</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onSet(task.id, "extension_requested")}>Request extension</button>
          <button className="btn btn-danger btn-sm" onClick={() => onSet(task.id, "issue_reported")}>Report issue</button>
        </div>
      )}
    </div>
  );
}
