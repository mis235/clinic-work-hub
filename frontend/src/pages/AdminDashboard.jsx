import MyFinesCard from "../components/MyFinesCard.jsx";
import MyPayslips from "../components/MyPayslips.jsx";
import MyOfferLetters from "../components/MyOfferLetters.jsx";
import TeamBoard from "../components/TeamBoard.jsx";
import AskLumiBar from "../components/AskLumiBar.jsx";
import Lumi from "../components/Lumi.jsx";
import HrOverview from "../components/HrOverview.jsx";
import RoomsCard from "../components/RoomsCard.jsx";
import { useEffect, useState, useCallback } from "react";
import { navItemsFor } from "../navItems.js";
import { api } from "../api.js";
import { STATUS, effectiveStatus } from "../constants.js";
import Sidebar from "../components/Sidebar.jsx";
import MobileTopBar from "../components/MobileTopBar.jsx";
import HeroBanner from "../components/HeroBanner.jsx";
import { Kpi, WeekBars, StatusDonut, EomCard } from "../components/DashWidgets.jsx";
import Doll from "../components/Doll.jsx";
import { doll } from "../components/Doll.jsx";
import Icon, { initials } from "../components/Icon.jsx";

const todayISO = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10); // India date
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

const firstName = (n = "") => n.split(/\s+/).find((w) => !/^dr\.?$/i.test(w)) || n;

export default function AdminDashboard({ user, onLogout, onNavigate, onOpenProfile }) {
  const [roster, setRoster] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [board, setBoard] = useState(null);
  const [summary, setSummary] = useState(null);
  const [shiftToday, setShiftToday] = useState({ submissions: [], missing: [] });
  const [filter, setFilter] = useState("open");
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const canAssign = user.role === "admin" || user.role === "manager";

  const refresh = useCallback(async () => {
    const [r, t, a, s, sh] = await Promise.all([
      api.listRosterFull(),
      api.listTasks(),
      api.attendanceBoard().catch(() => null),
      api.getReports().catch(() => null),
      api.getShiftChecklistSubmissions({ date: todayISO() }).catch(() => ({ submissions: [], missing: [] })),
    ]);
    setRoster(r); setTasks(t); setBoard(a); setSummary(s); setShiftToday(sh);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Poll so replies from WhatsApp, task updates and live checklist progress show up without a manual refresh.
    const id = setInterval(refresh, 8000);
    window.addEventListener("hub-refresh", refresh);
    return () => { clearInterval(id); window.removeEventListener("hub-refresh", refresh); };
  }, [refresh]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000); }
  async function handleAssign(payload) {
    await api.createTask(payload);
    doll("success", 3000);
    flash(payload.sendNow ? "Task created and sent to WhatsApp." : "Task created.");
    refresh();
  }
  async function handleSend(taskId) {
    try { await api.sendTask(taskId); flash("Sent via WhatsApp."); refresh(); } catch (e) { flash(e.message); }
  }

  const counts = {};
  Object.keys(STATUS).forEach((k) => (counts[k] = 0));
  tasks.forEach((t) => (counts[effectiveStatus(t)] = (counts[effectiveStatus(t)] || 0) + 1));
  const assignable = roster.filter((r) => r.role !== "admin");

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const overdueTasks = tasks.filter((t) => effectiveStatus(t) === "overdue").length;
  const completionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : null;
  const subs = shiftToday.submissions || [];
  const submitted = subs.filter((s) => s.status === "submitted");
  const inProgress = subs.filter((s) => s.status === "in_progress");
  const expected = subs.length + (shiftToday.missing || []).length;
  const checkedIn = (board?.counts?.P || 0) + (board?.counts?.L || 0) + (board?.counts?.H || 0);
  const comp = summary?.completion;

  const visibleTasks = tasks.filter((t) => {
    const st = effectiveStatus(t);
    if (filter === "open") return t.status !== "done";
    if (filter === "overdue") return st === "overdue";
    if (filter === "done") return t.status === "done";
    return true;
  });
  const dateLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="app-shell">
      <Sidebar
        items={navItemsFor(user)}
        active="Dashboard"
        onSelect={(item) => item !== "Dashboard" && onNavigate(item)}
        who={`${user.name} · ${user.role === "admin" ? "Admin" : "Manager"}`}
        onLogout={onLogout}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main className="main">
        <MobileTopBar title="Dashboard" onOpenMenu={() => setMobileOpen(true)} />

        <AskLumiBar />
        <HeroBanner user={user}>
          {canAssign && <button className="btn btn-light" onClick={() => setShowForm(true)}><Icon name="plus" size={16} /> Assign task</button>}
        </HeroBanner>

        <div className="kpi-grid">
          <Kpi icon="tasks" tone="violet" value={comp?.overall_pct == null ? "—" : `${comp.overall_pct}%`} label="Work completion" hint="Last 30 days" good />
          <Kpi icon="alert" tone="red" value={overdueTasks} label="Overdue tasks" hint={overdueTasks ? "Follow up today" : "All on track"} good={!overdueTasks} />
          <Kpi icon="clipboard" tone="amber" value={`${submitted.length}/${expected || 0}`} label="Checklists today" hint={inProgress.length ? `${inProgress.length} in progress` : "Submitted"} />
          <Kpi icon="fingerprint" tone="blue" value={`${checkedIn}/${board?.total ?? assignable.length}`} label="Present today" hint="Attendance" />
        </div>

        <div className="dash-row r-65">
          <WeekBars trend={summary?.completionTrend || []} />
          <StatusDonut counts={counts} />
        </div>

        <div className="dash-row r-65">
          <div className="card dw-card">
            <div className="dw-head"><div className="dw-title">Today's shift checklists</div><button className="dw-link" onClick={() => onNavigate("Dashboards")}>See all</button></div>
            {subs.length === 0 && <div className="meta" style={{ padding: "10px 0" }}>Nobody has started yet.</div>}
            {subs.slice(0, 4).map((s) => (
              <div key={s.id} className="rp-row">
                <div className="rp-thumb">{initials(s.staffName)}</div>
                <div className="rp-main"><div className="rp-name" onClick={() => onOpenProfile?.(s.userId)}>{s.staffName}</div><div className="rp-sub">{s.shift} · {s.roleName}</div>
                  <div className={`progress ${s.status === "submitted" ? "green" : "amber"}`} style={{ marginTop: 6 }}><span style={{ width: `${s.completionPct}%` }} /></div></div>
                <span className="rp-pct">{s.completionPct}%</span>
                <button className="rp-go" onClick={() => onNavigate("Dashboards")} aria-label="Open"><Icon name="arrowRight" size={16} /></button>
              </div>))}
            {(shiftToday.missing || []).length > 0 && <div className="meta" style={{ paddingTop: 10 }}><strong>{shiftToday.missing.length}</strong> not started: {shiftToday.missing.slice(0, 3).map((m) => m.name).join(", ")}{shiftToday.missing.length > 3 ? "…" : ""}</div>}
          </div>
          <EomCard canAnnounce onNavigate={onNavigate} />
        </div>


        <TeamBoard canAnnounce hideEom onNavigate={onNavigate} />
        <MyFinesCard />
        {user.role !== "admin" && <><MyPayslips /><MyOfferLetters /></>}
        <HrOverview user={user} onNavigate={onNavigate} />
        <RoomsCard onNavigate={onNavigate} />

        <div className="section-head">
          <div><h2>Task Board</h2><div className="sub">Assigned work across the team, updated live</div></div>
        </div>
        <div className="stat-grid">
          {Object.keys(STATUS).filter((k) => k !== "extension_requested" && k !== "issue_reported").map((k) => (
            <div key={k} className={`stat-card ${k}`}>
              <div className="num">{counts[k] || 0}</div>
              <div className="lbl">{STATUS[k].label}</div>
            </div>
          ))}
        </div>
        <div className="pill-row">
          {[["open", "Open"], ["overdue", "Overdue"], ["done", "Done"], ["all", "All"]].map(([k, label]) => (
            <button key={k} className={`pill ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>

        {loading && <div className="empty pose-empty"><Doll mood="working" size={200} follow={false} />Loading…</div>}
        {!loading && assignable.map((s) => {
          const mine = visibleTasks.filter((t) => t.user_id === s.id);
          if (mine.length === 0) return null;
          return (
            <div key={s.id} className="card">
              <div className="card-head">
                <div className="person-row" style={{ gap: 10 }}>
                  <div className="avatar sm">{initials(s.name)}</div>
                  <div><span className="name">{s.name}</span><span className="dept">{s.department}{s.role === "manager" ? " · Manager" : ""}</span></div>
                </div>
                <span className="phone">{s.phone}</span>
              </div>
              {mine.map((t) => <TaskRow key={t.id} task={t} onSend={handleSend} canAssign={canAssign} />)}
            </div>
          );
        })}
        {!loading && visibleTasks.length === 0 && (
          <div className="empty">{tasks.length === 0 ? "No tasks yet. Assign the first task to get the board moving." : "No tasks in this view."}</div>
        )}

        <div className="section-head"><h2>Today's Attendance</h2><button className="btn btn-ghost btn-sm" onClick={() => onNavigate("Attendance")}>Full board</button></div>
        {!board || !board.rows || board.rows.every((r) => !r.mark) ? (
          <div className="empty">Attendance not marked yet today.</div>
        ) : (
          <div className="card att-chips">
            {board.rows.filter((r) => r.mark).slice(0, 60).map((r) => (
              <div key={r.id} className="att-chip"><div className="avatar sm">{initials(r.name)}</div><div className="att-n"><div className="title">{r.name}</div><div className="meta">{r.department}</div></div><span className={`badge ${r.mark === "P" ? "done" : r.mark === "A" || r.mark === "L" ? "overdue" : "accepted"}`}>{r.mark_label}</span></div>
            ))}
          </div>
        )}

        {showForm && <AssignModal roster={assignable} onClose={() => setShowForm(false)} onAssign={handleAssign} />}
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  );
}

function TaskRow({ task, onSend, canAssign }) {
  const st = STATUS[effectiveStatus(task)];
  return (
    <div className="task-row">
      <div>
        <div className="title">{task.title}</div>
        <div className="meta">{task.category}{task.due_date ? ` · due ${new Date(task.due_date).toLocaleString()}` : ""}</div>
      </div>
      <div className="right">
        <span className={`badge ${st.cls}`}>{st.label}</span>
        {canAssign && task.status === "pending" && (
          <button className="btn-wa" onClick={() => onSend(task.id)}>Send WhatsApp</button>
        )}
      </div>
    </div>
  );
}

function AssignModal({ roster, onClose, onAssign }) {
  const [userId, setUserId] = useState(roster[0]?.id || "");
  useEffect(() => { if (!userId && roster[0]) setUserId(roster[0].id); }, [roster]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  function applyTemplate(id) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setTitle(t.title);
      setCategory(t.category);
      setNotes(t.default_notes || "");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Assign a Task</h3>

        <label className="field-label">Team Member</label>
        <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {roster.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.department}</option>)}
        </select>

        {templates.length > 0 && (
          <>
            <label className="field-label">Use a checklist template (optional)</label>
            <select className="field" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— Write a custom task instead —</option>
              {Object.entries(groupBy(templates, "category")).map(([cat, items]) => (
                <optgroup key={cat} label={cat}>
                  {items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </optgroup>
              ))}
            </select>
          </>
        )}

        <label className="field-label">Task / Checklist Item</label>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Confirm tomorrow's appointment list" />

        <label className="field-label">Category</label>
        <input className="field" value={category} onChange={(e) => setCategory(e.target.value)} />

        <label className="field-label">Due</label>
        <input className="field" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

        <label className="field-label">Notes (optional)</label>
        <textarea className="field" style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <label className="field-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          Send via WhatsApp immediately
        </label>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!title.trim()}
            onClick={() => {
              onAssign({ userId, title: title.trim(), category, dueDate: dueDate || null, notes, sendNow });
              onClose();
            }}
          >
            Assign task
          </button>
        </div>
      </div>
    </div>
  );
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    (acc[item[key]] ||= []).push(item);
    return acc;
  }, {});
}
