// HR: leave requests, the clinic's leave rules, late-arrival fines and birthdays.
// Rules (HR can change the numbers in Leave → HR rules):
//  - Only casual leave exists. Each person gets CASUAL_PER_MONTH free day(s) per month.
//  - Any approved day beyond that is unpaid: one day's salary is cut for each extra day.
//  - Late = arriving more than GRACE minutes after the start of the person's shift. Every LIMIT-th late in a month adds a fine (HR sets the amount).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { shiftFor, getTypes } from "./roster.js";
import { accessFor } from "../access.js";

const router = Router();
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
db.exec(`CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, days REAL NOT NULL,
  reason_type TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT, decided_at TEXT, mgmt_ok TEXT, hr_note TEXT, seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id, from_date);`);
for (const sql of [
  "ALTER TABLE fines ADD COLUMN auto_key TEXT", "ALTER TABLE leave_requests ADD COLUMN hr_confirmed_at TEXT", "ALTER TABLE leave_requests ADD COLUMN hr_confirmed_by TEXT",
  "ALTER TABLE payslips ADD COLUMN leave_taken REAL", "ALTER TABLE payslips ADD COLUMN leave_allowed REAL",
  "ALTER TABLE payslips ADD COLUMN lop_days REAL", "ALTER TABLE payslips ADD COLUMN lop_amount REAL",
  "ALTER TABLE payslips ADD COLUMN late_count INTEGER", "ALTER TABLE payslips ADD COLUMN fine_amount REAL",
]) { try { db.exec(sql); } catch {} }

export const REASONS = [
  { key: "sick", label: "Sick / medical" }, { key: "travel", label: "Travelling" }, { key: "family", label: "Family function / emergency" },
  { key: "personal", label: "Personal work" }, { key: "other", label: "Other" },
];
const DEFAULTS = { casual_per_month: 1, late_grace_min: 15, late_limit: 3, late_fine: 100, salary_divisor: 30 };
export function settings() {
  const o = { ...DEFAULTS };
  for (const r of db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'hr_%'").all()) { const k = r.key.slice(3); if (k in o && Number.isFinite(Number(r.value))) o[k] = Number(r.value); }
  return o;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** HR = the admin, or anyone whose job title says HR (e.g. "HR Executive"). */
export function isHr(userId, roleName) { return accessFor(userId, roleName).isHr; }
const isLead = (u) => u.roleName === "admin" || u.roleName === "manager";
const needHr = (req, res) => (isHr(req.user.userId, req.user.roleName) ? true : (res.status(403).json({ error: "Only HR or admin can do this" }), false));

// ---- leave maths -------------------------------------------------------------------------------
function daysInMonth(r, month) {
  const first = month + "-01", last = addDays(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
  const from = r.from_date > first ? r.from_date : first, to = r.to_date < last ? r.to_date : last;
  if (to < from) return 0;
  const n = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  return r.days === 0.5 ? 0.5 : n;
}
export function leaveSummary(userId, month) {
  const s = settings();
  const rows = db.prepare("SELECT * FROM leave_requests WHERE user_id = ? AND status = 'approved' AND substr(from_date,1,7) <= ? AND substr(to_date,1,7) >= ?").all(userId, month, month);
  const taken = rows.reduce((t, r) => t + daysInMonth(r, month), 0);
  const pendRows = db.prepare("SELECT * FROM leave_requests WHERE user_id = ? AND status IN ('pending','with_management') AND substr(from_date,1,7) <= ? AND substr(to_date,1,7) >= ?").all(userId, month, month);
  const pending = pendRows.reduce((t, r) => t + daysInMonth(r, month), 0);
  const allowed = s.casual_per_month;
  return { month, allowed, taken, pending, freeLeft: Math.max(0, allowed - taken), lopDays: Math.max(0, taken - allowed) };
}
export function lopAmount(userId, month, profile) {
  const ls = leaveSummary(userId, month), s = settings();
  const daily = ((profile?.basic_salary || 0) + (profile?.other_allowances || 0)) / s.salary_divisor;
  return { ...ls, perDay: Math.round(daily * 100) / 100, amount: Math.round(ls.lopDays * daily) };
}

// ---- late arrivals ----------------------------------------------------------------------------
/** Is arriving at hh:mm on this date late? (more than the grace period after the shift start; falls back to 10:00 with no shift planned) */
export function isLateArrival(userId, date, hhmm) {
  const st = shiftFor(userId, date);
  const start = (st && getTypes()[st]?.start) || process.env.LATE_AFTER_FALLBACK || "10:00";
  return mins(hhmm) > mins(start) + settings().late_grace_min;
}
export function lateDays(userId, month) {
  const rows = db.prepare("SELECT mark_date, status, in_time, marked_by FROM attendance_marks WHERE user_id = ? AND substr(mark_date,1,7) = ? AND status IN ('P','L') ORDER BY mark_date").all(userId, month);
  return rows.filter((r) => (r.in_time && !r.marked_by ? isLateArrival(userId, r.mark_date, r.in_time) : r.status === "L")).map((r) => ({ date: r.mark_date, inTime: r.in_time }));
}
/** Keeps the automatic late fines in step with the attendance marks (safe to run any time, any number of times). */
export function syncLateFines(month) {
  const s = settings(), made = [];
  for (const u of db.prepare("SELECT id, name FROM users WHERE active = 1").all()) {
    const late = lateDays(u.id, month), want = s.late_limit > 0 ? Math.floor(late.length / s.late_limit) : 0;
    const have = db.prepare("SELECT id, auto_key FROM fines WHERE user_id = ? AND auto_key LIKE ?").all(u.id, `late:${month}:%`);
    for (let n = 1; n <= want; n++) {
      const key = `late:${month}:${n}`;
      if (have.some((h) => h.auto_key === key)) continue;
      const d = late[n * s.late_limit - 1].date;
      db.prepare("INSERT INTO fines (id, user_id, fine_date, category, amount, note, added_by, auto_key) VALUES (?,?,?,?,?,?,NULL,?)")
        .run(randomUUID(), u.id, d, "late", s.late_fine, `Auto: ${n * s.late_limit} late arrivals this month`, key);
      made.push({ name: u.name, key });
    }
    for (const h of have) { const n = Number(h.auto_key.split(":")[2]); if (n > want) db.prepare("DELETE FROM fines WHERE id = ?").run(h.id); }
  }
  return made;
}

/** What goes on the payslip: leave figures, late count, fines, and the one-day-salary cut for leave beyond the free days. */
export function payslipExtras(profile, month) {
  syncLateFines(month);
  const lop = lopAmount(profile.user_id, month, profile);
  const lateCount = lateDays(profile.user_id, month).length;
  return { lop, lateCount };
}
export function stampPayslip(id, profile) {
  const l = profile.lop;
  if (!l) return;
  db.prepare("UPDATE payslips SET leave_taken=?, leave_allowed=?, lop_days=?, lop_amount=?, late_count=?, fine_amount=? WHERE id=?")
    .run(l.taken, l.allowed, l.lopDays, l.amount, profile.lateCount || 0, profile.fines || 0, id);
}

// ---- birthdays -------------------------------------------------------------------------------
export function birthdays(limitDays = 365) {
  const t = today(), y = +t.slice(0, 4);
  return db.prepare("SELECT u.id, u.name, u.birthday, u.designation, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 AND u.birthday IS NOT NULL").all()
    .map((u) => {
      const md = String(u.birthday).slice(-5);
      if (!/^\d{2}-\d{2}$/.test(md)) return null;
      let next = `${y}-${md}`; if (next < t) next = `${y + 1}-${md}`;
      return { id: u.id, name: u.name, designation: u.designation, department: u.department, date: md, next, inDays: Math.round((new Date(next) - new Date(t)) / 86400000) };
    }).filter((b) => b && b.inDays <= limitDays).sort((a, b) => a.inDays - b.inDays);
}

// ---- API --------------------------------------------------------------------------------------
router.get("/config", requireAuth, (req, res) => res.json({ reasons: REASONS, settings: settings(), isHr: isHr(req.user.userId, req.user.roleName) }));
router.put("/settings", requireAuth, (req, res) => {
  if (!needHr(req, res)) return;
  const b = req.body || {}, cur = settings();
  for (const k of Object.keys(DEFAULTS)) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return res.status(400).json({ error: `Check the number for ${k}` });
    db.prepare("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("hr_" + k, String(v));
    cur[k] = v;
  }
  syncLateFines(today().slice(0, 7));
  audit({ userId: req.user.userId, action: "HR_RULES_CHANGED", detail: JSON.stringify(cur) });
  res.json(settings());
});

const withName = `SELECT l.*, u.name AS staff_name, u.designation, d.name AS department, h.name AS decided_by_name
  FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users h ON h.id = l.decided_by`;

router.get("/mine", requireAuth, (req, res) => {
  const month = today().slice(0, 7);
  res.json({ summary: leaveSummary(req.user.userId, month), rules: settings(), requests: db.prepare(withName + " WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 60").all(req.user.userId) });
});

router.post("/apply", requireAuth, (req, res) => {
  const { fromDate, toDate, halfDay, reasonType, reason } = req.body || {};
  if (!DATE.test(fromDate || "")) return res.status(400).json({ error: "Choose the first day of leave" });
  const to = DATE.test(toDate || "") ? toDate : fromDate;
  if (to < fromDate) return res.status(400).json({ error: "The last day cannot be before the first day" });
  if (fromDate < addDays(today(), -7)) return res.status(400).json({ error: "Leave older than a week cannot be applied here. Ask HR." });
  if (!REASONS.some((r) => r.key === reasonType)) return res.status(400).json({ error: "Choose a reason" });
  if (reasonType === "other" && !String(reason || "").trim()) return res.status(400).json({ error: "Please write the reason" });
  const days = halfDay && fromDate === to ? 0.5 : Math.round((new Date(to) - new Date(fromDate)) / 86400000) + 1;
  if (days > 31) return res.status(400).json({ error: "Too many days in one request" });
  const clash = db.prepare("SELECT 1 FROM leave_requests WHERE user_id = ? AND status IN ('pending','with_management','approved') AND from_date <= ? AND to_date >= ?").get(req.user.userId, to, fromDate);
  if (clash) return res.status(409).json({ error: "You already have a leave request on these days" });
  const id = randomUUID();
  db.prepare("INSERT INTO leave_requests (id, user_id, from_date, to_date, days, reason_type, reason) VALUES (?,?,?,?,?,?,?)")
    .run(id, req.user.userId, fromDate, to, days, reasonType, reason ? String(reason).slice(0, 500) : null);
  audit({ userId: req.user.userId, action: "LEAVE_APPLIED", detail: `${fromDate}..${to} ${reasonType}` });
  const ls = leaveSummary(req.user.userId, fromDate.slice(0, 7));
  res.status(201).json({ id, summary: ls, warning: ls.pending + ls.taken > ls.allowed ? `Only ${ls.allowed} day(s) a month are free. Each extra day cuts one day's salary.` : null });
});

router.delete("/:id", requireAuth, (req, res) => {
  const r = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!r || r.user_id !== req.user.userId) return res.status(404).json({ error: "Not found" });
  if (r.status !== "pending") return res.status(400).json({ error: "Only a waiting request can be cancelled. Ask HR." });
  db.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

// HR / admin: all requests (filter ?status= ?month=)
router.get("/requests", requireAuth, (req, res) => {
  if (!needHr(req, res)) return;
  const q = []; const a = [];
  if (req.query.status === "open") q.push("l.status IN ('pending','with_management')");
  else if (["pending", "with_management", "approved", "rejected", "cancelled"].includes(req.query.status)) { q.push("l.status = ?"); a.push(req.query.status); }
  if (/^\d{4}-\d{2}$/.test(req.query.month || "")) { q.push("substr(l.from_date,1,7) <= ? AND substr(l.to_date,1,7) >= ?"); a.push(req.query.month, req.query.month); }
  const rows = db.prepare(withName + (q.length ? " WHERE " + q.join(" AND ") : "") + " ORDER BY (l.status IN ('pending','with_management')) DESC, l.from_date DESC LIMIT 300").all(...a);
  for (const r of rows) r.summary = leaveSummary(r.user_id, r.from_date.slice(0, 7));
  res.json(rows);
});

// Step 2 (HR): the leave letter has been received and checked; it now goes to Sir / Mam for their signature.
router.post("/:id/confirm", requireAuth, (req, res) => {
  if (!needHr(req, res)) return;
  const r = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "pending") return res.status(400).json({ error: "This request is not waiting for HR any more" });
  db.prepare("UPDATE leave_requests SET status = 'with_management', hr_confirmed_at = datetime('now'), hr_confirmed_by = ?, hr_note = COALESCE(?, hr_note) WHERE id = ?")
    .run(req.user.userId, req.body?.note ? String(req.body.note).slice(0, 300) : null, r.id);
  audit({ userId: req.user.userId, action: "LEAVE_CONFIRMED_BY_HR", detail: `${r.user_id} ${r.from_date}..${r.to_date}` });
  res.json({ ok: true });
});

// Step 3 (HR): after Sir's / Mam's signature HR records the result (who signed is saved) and the staff member is told.
router.post("/:id/decide", requireAuth, (req, res) => {
  if (!needHr(req, res)) return;
  const { decision, mgmtOk, note } = req.body || {};
  const r = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status === "cancelled") return res.status(400).json({ error: "The staff member cancelled this request" });
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject" });
  if (decision === "approved" && !["Sir", "Mam", "Sir & Mam"].includes(mgmtOk)) return res.status(400).json({ error: "Tick who approved this: Sir, Mam, or both" });
  db.prepare("UPDATE leave_requests SET status=?, decided_by=?, decided_at=datetime('now'), mgmt_ok=?, hr_note=?, seen_at=NULL WHERE id=?")
    .run(decision, req.user.userId, decision === "approved" ? mgmtOk : null, note ? String(note).slice(0, 300) : null, r.id);
  if (decision === "approved") {   // show it in the attendance register as leave
    for (let d = r.from_date; d <= r.to_date; d = addDays(d, 1)) {
      db.prepare(`INSERT INTO attendance_marks (user_id, mark_date, status, note, marked_by) VALUES (?,?,'LV',?,?)
        ON CONFLICT(user_id, mark_date) DO UPDATE SET status = 'LV', note = excluded.note WHERE attendance_marks.status NOT IN ('P','L','H')`)
        .run(r.user_id, d, "Approved leave", req.user.userId);
    }
  } else db.prepare("DELETE FROM attendance_marks WHERE user_id = ? AND mark_date BETWEEN ? AND ? AND status = 'LV' AND note = 'Approved leave'").run(r.user_id, r.from_date, r.to_date);
  audit({ userId: req.user.userId, action: "LEAVE_" + decision.toUpperCase(), detail: `${r.user_id} ${r.from_date}..${r.to_date}` });
  res.json({ ok: true, summary: leaveSummary(r.user_id, r.from_date.slice(0, 7)) });
});

router.post("/seen", requireAuth, (req, res) => {
  db.prepare("UPDATE leave_requests SET seen_at = datetime('now') WHERE user_id = ? AND status IN ('approved','rejected') AND seen_at IS NULL").run(req.user.userId);
  res.json({ ok: true });
});

router.get("/birthdays", requireAuth, (req, res) => {
  if (!isLead(req.user) && !isHr(req.user.userId, req.user.roleName)) return res.status(403).json({ error: "Not allowed" });
  res.json(birthdays(Number(req.query.days) || 60));
});

router.get("/late", requireAuth, (req, res) => {
  if (!isLead(req.user) && !isHr(req.user.userId, req.user.roleName)) return res.status(403).json({ error: "Not allowed" });
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : today().slice(0, 7);
  syncLateFines(month);
  const s = settings();
  const rows = db.prepare("SELECT id, name FROM users WHERE active = 1 ORDER BY name").all().map((u) => {
    const late = lateDays(u.id, month);
    const fine = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM fines WHERE user_id = ? AND auto_key LIKE ?").get(u.id, `late:${month}:%`).t;
    return { id: u.id, name: u.name, count: late.length, dates: late, fine, nextFineIn: s.late_limit ? s.late_limit - (late.length % s.late_limit) : null };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  res.json({ month, rules: s, rows });
});

// Everything the Overview pop-ups need.
router.get("/overview", requireAuth, (req, res) => {
  const t = today(), month = t.slice(0, 7), hr = isHr(req.user.userId, req.user.roleName), lead = isLead(req.user);
  const mine = {
    summary: leaveSummary(req.user.userId, month),
    waiting: db.prepare("SELECT COUNT(*) n FROM leave_requests WHERE user_id = ? AND status IN ('pending','with_management')").get(req.user.userId).n,
    news: db.prepare(withName + " WHERE l.user_id = ? AND l.status IN ('approved','rejected') AND l.seen_at IS NULL ORDER BY l.decided_at DESC").all(req.user.userId),
  };
  const out = { isHr: hr, mine };
  if (hr || lead) {
    out.pending = hr ? db.prepare(withName + " WHERE l.status IN ('pending','with_management') ORDER BY l.from_date").all() : [];
    out.recent = db.prepare(withName + " WHERE l.status IN ('approved','rejected') AND date(l.decided_at) >= ? ORDER BY l.decided_at DESC LIMIT 20").all(addDays(t, -7));
    out.onLeaveToday = db.prepare(withName + " WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ?").all(t, t);
    out.upcoming = db.prepare(withName + " WHERE l.status = 'approved' AND l.from_date > ? AND l.from_date <= ? ORDER BY l.from_date").all(t, addDays(t, 14));
    const b = birthdays(60);
    out.birthdaysToday = b.filter((x) => x.inDays === 0);
    out.birthdaysMonth = b.filter((x) => x.next.slice(0, 7) === month || x.inDays === 0);
    out.birthdaysSoon = b.filter((x) => x.inDays > 0 && x.inDays <= 30);
    syncLateFines(month);
    const s = settings();
    out.late = db.prepare("SELECT id, name FROM users WHERE active = 1").all().map((u) => ({ id: u.id, name: u.name, count: lateDays(u.id, month).length })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
    out.lateRules = s;
  }
  res.json(out);
});

export default router;
