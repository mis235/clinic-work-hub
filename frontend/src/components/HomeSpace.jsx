import { useEffect, useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Calcutta" });
const dnice = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS = { pending: "Pending", with_management: "With management", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };

// Home layout: "My Space" (check-in, leaves, my requests) and, for leaders, "Team Space".
// `go(key)` opens one of the left-menu pages (Attendance, Leave, ...).
export default function HomeSpace({ user, go, canTeam, canAssign, onAssign }) {
  const [att, setAtt] = useState(null), [lv, setLv] = useState(null), [fines, setFines] = useState(null);
  const [board, setBoard] = useState(null), [reqs, setReqs] = useState(null), [tab, setTab] = useState("leave"), [ttab, setTtab] = useState("leave");
  useEffect(() => {
    const load = () => {
      api.attendanceToday().then(setAtt).catch(() => {});
      api.myLeave().then(setLv).catch(() => {});
      api.myFines().then(setFines).catch(() => {});
      if (canTeam) { api.attendanceBoard().then(setBoard).catch(() => {}); api.leaveRequests("open").then(setReqs).catch(() => setReqs([])); }
    };
    load(); window.addEventListener("hub-refresh", load); const t = setInterval(load, 60000);
    return () => { window.removeEventListener("hub-refresh", load); clearInterval(t); };
  }, [canTeam]);

  const first = att?.records?.find((r) => r.type === "check_in"), last = att?.records?.[att.records.length - 1];
  const checkedIn = !!first, out = last?.type === "check_out";
  const s = lv?.summary, remaining = s ? Math.max(0, s.allowed - s.taken - s.pending) : "—";
  const myReqs = (lv?.requests || []).slice(0, 4), myFines = (fines?.rows || []).slice(0, 4);
  const present = board ? (board.counts?.P || 0) + (board.counts?.L || 0) + (board.counts?.H || 0) : null;
  const total = board?.total ?? null;

  return (
    <div className="home-spaces">
      <section className="space-card">
        <h3 className="space-title"><Icon name="user" size={18} /> My Space</h3>
        <div className="space-banner">
          <div><div style={{ fontWeight: 600, lineHeight: 1.45 }}>Mark attendance, apply for leave, view your payslip and keep up with clinic events in one place.</div>
            <a href="#" className="space-link" onClick={(e) => { e.preventDefault(); go("Leave"); }}>Explore →</a></div>
        </div>
        <div className="space-two">
          <div className="checkin-card">
            <div className="checkin-h">{!checkedIn ? "Check-In Required" : out ? "Day complete" : "You are checked in"}</div>
            <div className="checkin-s">{!checkedIn ? "Check in to start your day" : `In at ${hhmm(first.recorded_at)}${out ? ` · Out at ${hhmm(last.recorded_at)}` : ""}`}</div>
            <div className="checkin-date"><Icon name="clock" size={14} /> {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            <button className="checkin-btn" onClick={() => go("Attendance")}>{checkedIn ? "View attendance" : "Check-in"}</button>
          </div>
          <div className="leave-card">
            <div className="leave-h">Leaves</div>
            <div className="leave-row"><span>Availed</span><b>{s ? String(s.taken).padStart(2, "0") : "—"}</b></div>
            <div className="leave-row"><span>Remaining</span><b>{typeof remaining === "number" ? String(remaining).padStart(2, "0") : remaining}</b></div>
            <button className="leave-btn" onClick={() => go("Leave")}>Apply</button>
          </div>
        </div>
        <div className="space-sub">
          <div className="space-sub-h"><b>My Requests</b><a href="#" className="space-link" onClick={(e) => { e.preventDefault(); go("Leave"); }}>View all</a></div>
          <div className="space-tabs"><button className={tab === "leave" ? "on" : ""} onClick={() => setTab("leave")}>Leave <i>{lv?.requests?.length ?? 0}</i></button><button className={tab === "fines" ? "on" : ""} onClick={() => setTab("fines")}>Fines <i>{fines?.rows?.length ?? 0}</i></button></div>
          {tab === "leave" && (myReqs.length === 0 ? <div className="meta">No leave requests.</div> : myReqs.map((r) => (
            <div key={r.id} className="req-row"><div><b>{dnice(r.from_date)}{r.to_date !== r.from_date ? ` – ${dnice(r.to_date)}` : ""}</b><div className="meta">{r.days} day{r.days === 1 ? "" : "s"}{r.reason ? ` · ${r.reason}` : ""}</div></div><span className={`req-badge ${r.status}`}>{STATUS[r.status] || r.status}</span></div>)))}
          {tab === "fines" && (myFines.length === 0 ? <div className="meta">No fines. Keep it up!</div> : myFines.map((r) => (
            <div key={r.id} className="req-row"><div><b>{r.reason}</b><div className="meta">{dnice(r.fine_date)}{r.note ? ` · ${r.note}` : ""}</div></div><b style={{ color: "#b91c1c" }}>₹{r.amount}</b></div>)))}
        </div>
      </section>

      {canTeam && (
        <section className="space-card">
          <h3 className="space-title"><Icon name="users" size={18} /> Team Space</h3>
          <div className="space-banner team"><div style={{ fontWeight: 600 }}>Today's statistics</div>
            {canAssign && <button className="checkin-btn" style={{ width: "auto", padding: "8px 16px" }} onClick={onAssign}>+ Assign task</button>}</div>
          <div className="stat-line" onClick={() => go("Staff")}><span><Icon name="users" size={16} /> All Employees</span><b>{total ?? "—"}</b></div>
          <div className="stat-line" onClick={() => go("Attendance")}><span><Icon name="check" size={16} /> Present today</span><b>{present ?? "—"}</b></div>
          <div className="stat-line" onClick={() => go("Attendance")}><span><Icon name="alert" size={16} /> People Absent</span><b>{board && total != null ? Math.max(0, total - present) : "—"}</b></div>
          <div className="space-sub">
            <div className="space-sub-h"><b>Team Requests</b><a href="#" className="space-link" onClick={(e) => { e.preventDefault(); go("Leave"); }}>View all</a></div>
            <div className="space-tabs"><button className="on" onClick={() => setTtab("leave")}>Leave <i>{reqs?.length ?? 0}</i></button></div>
            {reqs === null ? <div className="meta">Loading…</div> : reqs.length === 0 ? <div className="meta">Nothing waiting for approval.</div> : reqs.slice(0, 4).map((r) => (
              <div key={r.id} className="req-row"><div><b>{r.staff_name}</b><div className="meta">{dnice(r.from_date)}{r.to_date !== r.from_date ? ` – ${dnice(r.to_date)}` : ""} · {r.days} day{r.days === 1 ? "" : "s"}</div></div><span className={`req-badge ${r.status}`}>{STATUS[r.status] || r.status}</span></div>))}
          </div>
        </section>)}
    </div>
  );
}
