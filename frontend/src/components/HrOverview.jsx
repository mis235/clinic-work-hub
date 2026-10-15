import { useEffect, useState } from "react";
import { api } from "../api.js";

const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const range = (r) => (r.from_date === r.to_date ? dmy(r.from_date) : `${dmy(r.from_date)} – ${dmy(r.to_date)}`);

// Overview cards + pop-ups: leave approvals, who is on leave, birthdays, late arrivals. Staff just see the answer to their own requests.
export default function HrOverview({ user, onNavigate }) {
  const [d, setD] = useState(null);
  const [pop, setPop] = useState(null);
  const load = () => api.leaveOverview().then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!d) return;
    const key = "hrpop-" + new Date().toDateString();
    if (sessionStorage.getItem(key)) return;
    const news = d.mine?.news || [], bd = d.birthdaysToday || [];
    if (news.length || bd.length || d.pending?.length) { setPop({ news, bd, pending: d.pending || [] }); try { sessionStorage.setItem(key, "1"); } catch {} }
  }, [d]);
  if (!d) return null;
  const lead = !!d.pending || !!d.recent;
  const close = () => { setPop(null); if (pop?.news.length) api.leaveSeen().then(load).catch(() => {}); };
  const go = () => { close(); onNavigate?.("Leave"); };

  return (
    <>
      {pop && (
        <div className="modal-backdrop" onClick={close}><div className="modal" onClick={(e) => e.stopPropagation()}>
          {pop.bd.length > 0 && <><h3>🎂 Birthday today</h3><p className="lead">{pop.bd.map((b) => b.name).join(", ")} — don't forget to wish {pop.bd.length > 1 ? "them" : "them"}!</p></>}
          {pop.news.length > 0 && <><h3 style={{ marginTop: pop.bd.length ? 14 : 0 }}>Your leave</h3>
            {pop.news.map((r) => <div key={r.id} className="task-row"><div><div className="title">{range(r)}</div><div className="meta">{r.hr_note || (r.status === "approved" ? `Approved by ${r.mgmt_ok}` : "")}</div></div><span className={`badge ${r.status === "approved" ? "done" : "overdue"}`}>{r.status === "approved" ? "Approved" : "Not approved"}</span></div>)}</>}
          {pop.pending.length > 0 && <><h3 style={{ marginTop: 14 }}>Leave waiting for you</h3><p className="lead">{pop.pending.length} request{pop.pending.length === 1 ? "" : "s"}: {pop.pending.slice(0, 4).map((r) => r.staff_name).join(", ")}</p></>}
          <div className="actions"><button className="btn btn-outline" onClick={close}>Close</button>{(pop.pending.length > 0 || pop.news.length > 0) && <button className="btn btn-primary" onClick={go}>Open Leave</button>}</div>
        </div></div>
      )}
      {lead ? (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-head"><div className="name">Leave</div><button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.("Leave")}>Open</button></div>
            {d.isHr && <Section title={`Waiting for approval (${d.pending.length})`} empty="Nothing waiting.">{d.pending.slice(0, 5).map((r) => <Line key={r.id} a={r.staff_name} b={range(r)} badge={r.status === "with_management" ? "With Sir/Mam" : "Waiting"} cls="in_progress" />)}</Section>}
            <Section title="Recently decided" empty="No decisions in the last 7 days.">{d.recent.slice(0, 6).map((r) => <Line key={r.id} a={r.staff_name} b={range(r)} badge={r.status === "approved" ? "Approved" : "Not approved"} cls={r.status === "approved" ? "done" : "overdue"} />)}</Section>
            <Section title={`On leave today (${d.onLeaveToday.length})`} empty="Everyone is in.">{d.onLeaveToday.map((r) => <Line key={r.id} a={r.staff_name} b={`until ${dmy(r.to_date)}`} />)}</Section>
            {d.upcoming.length > 0 && <Section title="Coming up (14 days)">{d.upcoming.map((r) => <Line key={r.id} a={r.staff_name} b={range(r)} />)}</Section>}
          </div>
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-head"><div className="name">Birthdays</div></div>
            {d.birthdaysToday.length > 0 && <div className="note" style={{ marginBottom: 8 }}>🎂 Today: <b>{d.birthdaysToday.map((b) => b.name).join(", ")}</b></div>}
            <Section title="This month" empty="No birthdays this month.">{d.birthdaysMonth.filter((b) => b.inDays > 0).map((b) => <Line key={b.id} a={b.name} b={dmy(b.next)} />)}</Section>
            {d.birthdaysSoon.filter((b) => !d.birthdaysMonth.some((m) => m.id === b.id)).length > 0 && <Section title="Next 30 days">{d.birthdaysSoon.filter((b) => !d.birthdaysMonth.some((m) => m.id === b.id)).map((b) => <Line key={b.id} a={b.name} b={dmy(b.next)} />)}</Section>}
            {d.late.length > 0 && <Section title={`Late arrivals this month (fine after every ${d.lateRules.late_limit})`}>{d.late.map((l) => <Line key={l.id} a={l.name} b={`${l.count} late`} badge={l.count >= d.lateRules.late_limit ? "Fine" : null} cls="overdue" />)}</Section>}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head"><div className="name">My leave</div><button className="btn btn-ghost btn-sm" onClick={() => onNavigate?.("Leave")}>Apply</button></div>
          <div className="meta">Free leave left this month: <b>{d.mine.summary.freeLeft}</b> of {d.mine.summary.allowed}{d.mine.waiting ? ` · ${d.mine.waiting} request${d.mine.waiting === 1 ? "" : "s"} waiting for HR` : ""}{d.mine.summary.lopDays ? ` · ${d.mine.summary.lopDays} unpaid day(s) this month` : ""}</div>
        </div>
      )}
    </>
  );
}
const Section = ({ title, empty, children }) => { const arr = [].concat(children).flat().filter(Boolean); return <div style={{ marginTop: 10 }}><div className="meta" style={{ fontWeight: 700, textTransform: "uppercase", fontSize: 11, letterSpacing: ".04em" }}>{title}</div>{arr.length ? arr : empty && <div className="meta" style={{ padding: "6px 0" }}>{empty}</div>}</div>; };
const Line = ({ a, b, badge, cls }) => <div className="task-row" style={{ padding: "7px 0" }}><div><div className="title" style={{ fontSize: 13 }}>{a}</div><div className="meta">{b}</div></div>{badge && <span className={`badge ${cls || ""}`}>{badge}</span>}</div>;
