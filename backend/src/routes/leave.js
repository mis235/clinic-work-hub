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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeaveLetter } from "../leave-letter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, ".."), "signatures");
fs.mkdirSync(SIG_DIR, { recursive: true });
const sigFile = (userId) => path.join(SIG_DIR, `user-${String(userId).replace(/[^\w-]/g, "")}.png`);

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
db.exec(`CREATE TABLE IF NOT EXISTS leave_approvals (
  id TEXT PRIMARY KEY, leave_id TEXT NOT NULL REFERENCES leave_requests(id), step INTEGER NOT NULL, label TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'waiting', decided_at TEXT, note TEXT, signature_file TEXT,
  UNIQUE(leave_id, step)
);`);
for (const sql of [
  "ALTER TABLE leave_requests ADD COLUMN cover_user_id TEXT", "ALTER TABLE leave_requests ADD COLUMN cover_note TEXT", "ALTER TABLE leave_requests ADD COLUMN step INTEGER NOT NULL DEFAULT 0", "ALTER TABLE leave_requests ADD COLUMN applicant_signature TEXT",
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
  // Days nobody marked (auto-marked as leave at night) count as casual leave too: 1 free per month, the rest cut from salary.
  const autoDays = db.prepare("SELECT COUNT(*) n FROM attendance_marks WHERE user_id = ? AND substr(mark_date,1,7) = ? AND status = 'LV' AND note = 'Auto: no attendance'").get(userId, month)?.n || 0;
  const taken = rows.reduce((t, r) => t + daysInMonth(r, month), 0) + autoDays;
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

const withName = `SELECT l.*, u.name AS staff_name, u.designation, d.name AS department, h.name AS decided_by_name, c.name AS cover_name
  FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users h ON h.id = l.decided_by LEFT JOIN users c ON c.id = l.cover_user_id`;

// ---- approval chain: HR -> COS -> Director -> Owner (Dr. Nishita) --------------------------------------------------
const setting = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value;
/** Who signs, in order. Finds them by job title / name; the admin can pin a person with the app_settings keys leave_cos, leave_director, leave_owner. */
export function approverChain() {
  const pick = (key, sql) => {
    const pinned = setting(key);
    if (pinned) { const u = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").get(pinned); if (u) return u; }
    return db.prepare(sql).get();
  };
  const chain = [
    ["COS", pick("leave_cos", "SELECT id, name FROM users WHERE active = 1 AND (designation LIKE 'COS%' OR designation LIKE '%Chief of Staff%' OR name LIKE 'Naga%') ORDER BY (designation LIKE 'COS%') DESC LIMIT 1")],
    ["Director", pick("leave_director", "SELECT id, name FROM users WHERE active = 1 AND name LIKE 'Shreyas%' LIMIT 1")],
    ["Owner", pick("leave_owner", "SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND r.name = 'admin' ORDER BY (u.name LIKE '%Nishita%') DESC LIMIT 1")],
  ];
  const seen = new Set();
  return chain.filter(([, u]) => u && !seen.has(u.id) && seen.add(u.id)).map(([label, u]) => ({ label, userId: u.id, name: u.name }));
}
const LABEL_TEXT = { COS: "COS", Director: "Director", Owner: "Dr. Nishita" };
function chainOf(leaveId) {
  return db.prepare("SELECT a.step, a.label, a.user_id, a.status, a.decided_at, a.note, u.name FROM leave_approvals a JOIN users u ON u.id = a.user_id WHERE a.leave_id = ? ORDER BY a.step").all(leaveId);
}
function attachChain(rows) { for (const r of rows) r.chain = chainOf(r.id); return rows; }
/** HR, admin and the people who sign leave may see everyone's leave; nobody else. */
export function canSeeAllLeave(userId, roleName) { return roleName === "admin" || isHr(userId, roleName) || approverChain().some((a) => a.userId === userId); }
const canSee = (r, userId, roleName) => r.user_id === userId || isHr(userId, roleName) || !!db.prepare("SELECT 1 FROM leave_approvals WHERE leave_id = ? AND user_id = ?").get(r.id, userId);

router.get("/mine", requireAuth, (req, res) => {
  const month = today().slice(0, 7);
  res.json({ summary: leaveSummary(req.user.userId, month), rules: settings(), requests: attachChain(db.prepare(withName + " WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 60").all(req.user.userId)) });
});

router.post("/apply", requireAuth, (req, res) => {
  const { fromDate, toDate, halfDay, reasonType, reason, coverUserId, coverNote } = req.body || {};
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
  let cover = null;
  if (coverUserId) {
    cover = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(coverUserId);
    if (!cover || cover.id === req.user.userId) return res.status(400).json({ error: "Choose a colleague (not yourself) to cover your work" });
  }
  const id = randomUUID();
  let appSig = null;
  if (fs.existsSync(sigFile(req.user.userId))) { appSig = path.join(SIG_DIR, `leave-${id}-0.png`); fs.copyFileSync(sigFile(req.user.userId), appSig); }
  db.prepare("INSERT INTO leave_requests (id, user_id, from_date, to_date, days, reason_type, reason, cover_user_id, cover_note, applicant_signature) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, req.user.userId, fromDate, to, days, reasonType, reason ? String(reason).slice(0, 500) : null, cover?.id || null, coverNote ? String(coverNote).slice(0, 300) : null, appSig);
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
  res.json(attachChain(rows));
});

// Step 2 (HR): the leave letter has been received and checked; it now goes to Sir / Mam for their signature.
router.post("/:id/confirm", requireAuth, (req, res) => {
  if (!needHr(req, res)) return;
  const r = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "pending") return res.status(400).json({ error: "This request is not waiting for HR any more" });
  const chain = approverChain().filter((a) => a.userId !== r.user_id);   // you never sign your own leave
  db.prepare("UPDATE leave_requests SET status = 'with_management', step = ?, hr_confirmed_at = datetime('now'), hr_confirmed_by = ?, hr_note = COALESCE(?, hr_note) WHERE id = ?")
    .run(chain.length ? 1 : 0, req.user.userId, req.body?.note ? String(req.body.note).slice(0, 300) : null, r.id);
  db.prepare("DELETE FROM leave_approvals WHERE leave_id = ?").run(r.id);
  chain.forEach((a, i) => db.prepare("INSERT INTO leave_approvals (id, leave_id, step, label, user_id) VALUES (?,?,?,?,?)").run(randomUUID(), r.id, i + 1, a.label, a.userId));
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
  finalize(r, decision, decision === "approved" ? mgmtOk : null, note, req.user.userId);
  audit({ userId: req.user.userId, action: "LEAVE_" + decision.toUpperCase(), detail: `${r.user_id} ${r.from_date}..${r.to_date}` });
  res.json({ ok: true, summary: leaveSummary(r.user_id, r.from_date.slice(0, 7)) });
});

/** Records the final answer, writes the attendance marks and tells the staff member. */
function finalize(r, decision, mgmtOk, note, byUserId) {
  db.prepare("UPDATE leave_requests SET status=?, decided_by=?, decided_at=datetime('now'), mgmt_ok=?, hr_note=COALESCE(?, hr_note), seen_at=NULL WHERE id=?")
    .run(decision, byUserId, mgmtOk, note ? String(note).slice(0, 300) : null, r.id);
  if (decision === "approved") {   // show it in the attendance register as leave
    for (let d = r.from_date; d <= r.to_date; d = addDays(d, 1)) {
      db.prepare(`INSERT INTO attendance_marks (user_id, mark_date, status, note, marked_by) VALUES (?,?,'LV',?,?)
        ON CONFLICT(user_id, mark_date) DO UPDATE SET status = 'LV', note = excluded.note WHERE attendance_marks.status NOT IN ('P','L','H')`)
        .run(r.user_id, d, "Approved leave", byUserId);
    }
  } else db.prepare("DELETE FROM attendance_marks WHERE user_id = ? AND mark_date BETWEEN ? AND ? AND status = 'LV' AND note = 'Approved leave'").run(r.user_id, r.from_date, r.to_date);
}

// ---- signatures (each approver draws or uploads theirs once) ----------------------------------------------------------
router.get("/signature", requireAuth, (req, res) => {
  const f = sigFile(req.user.userId);
  res.json({ has: fs.existsSync(f), dataUrl: fs.existsSync(f) ? "data:image/png;base64," + fs.readFileSync(f).toString("base64") : null });
});
router.put("/signature", requireAuth, (req, res) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.dataUrl || "");
  if (!m) return res.status(400).json({ error: "Please draw your signature (PNG)" });
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 400 * 1024 || buf.length < 100 || buf.subarray(1, 4).toString() !== "PNG") return res.status(400).json({ error: "The signature picture is not valid or too big" });
  fs.writeFileSync(sigFile(req.user.userId), buf);
  res.json({ ok: true });
});
router.delete("/signature", requireAuth, (req, res) => { try { fs.unlinkSync(sigFile(req.user.userId)); } catch {} res.json({ ok: true }); });

// ---- approvers: COS -> Director -> Dr. Nishita --------------------------------------------------------------------------
router.get("/chain", requireAuth, (req, res) => res.json(approverChain().map((a) => ({ label: a.label, name: a.name }))));
router.get("/approvals", requireAuth, (req, res) => {
  const waiting = db.prepare(withName + " JOIN leave_approvals a ON a.leave_id = l.id AND a.user_id = ? AND a.status = 'waiting' AND a.step = l.step WHERE l.status = 'with_management' ORDER BY l.from_date").all(req.user.userId);
  const done = db.prepare(withName + " JOIN leave_approvals a ON a.leave_id = l.id AND a.user_id = ? AND a.status <> 'waiting' ORDER BY a.decided_at DESC LIMIT 20").all(req.user.userId);
  for (const r of [...waiting, ...done]) r.summary = leaveSummary(r.user_id, r.from_date.slice(0, 7));
  res.json({ waiting: attachChain(waiting), done: attachChain(done), hasSignature: fs.existsSync(sigFile(req.user.userId)) });
});
router.post("/:id/approve", requireAuth, (req, res) => {
  const { decision, note } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject" });
  const r = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.status !== "with_management") return res.status(400).json({ error: "This request is not waiting for a signature" });
  const a = db.prepare("SELECT * FROM leave_approvals WHERE leave_id = ? AND step = ?").get(r.id, r.step);
  if (!a || a.user_id !== req.user.userId) return res.status(403).json({ error: "It is not your turn to sign this leave" });
  let snap = null;
  if (decision === "approved") {
    if (!fs.existsSync(sigFile(req.user.userId))) return res.status(400).json({ error: "Please add your signature first (Leave → My signature)", needSignature: true });
    snap = path.join(SIG_DIR, `leave-${r.id}-${a.step}.png`);
    fs.copyFileSync(sigFile(req.user.userId), snap);
  }
  db.prepare("UPDATE leave_approvals SET status = ?, decided_at = datetime('now'), note = ?, signature_file = ? WHERE id = ?").run(decision, note ? String(note).slice(0, 300) : null, snap, a.id);
  const last = !db.prepare("SELECT 1 FROM leave_approvals WHERE leave_id = ? AND step > ?").get(r.id, a.step);
  if (decision === "rejected") finalize(r, "rejected", null, note, req.user.userId);
  else if (last) finalize(r, "approved", chainOf(r.id).map((c) => LABEL_TEXT[c.label] || c.label).join(" + "), note, req.user.userId);
  else db.prepare("UPDATE leave_requests SET step = step + 1 WHERE id = ?").run(r.id);
  audit({ userId: req.user.userId, action: "LEAVE_SIGN_" + decision.toUpperCase(), detail: `${r.user_id} ${r.from_date}..${r.to_date} step ${a.step}` });
  res.json({ ok: true, final: decision === "rejected" || last });
});

// ---- colleagues who can cover, and the work I am covering --------------------------------------------------------------
router.get("/colleagues", requireAuth, (req, res) => res.json(db.prepare("SELECT id, name, designation FROM users WHERE active = 1 AND id <> ? ORDER BY name").all(req.user.userId)));
router.get("/covering", requireAuth, (req, res) => {
  const t = today();
  const rows = db.prepare(withName + " WHERE l.cover_user_id = ? AND l.status = 'approved' AND l.to_date >= ? ORDER BY l.from_date").all(req.user.userId, t);
  const out = rows.map((r) => {
    const tasks = db.prepare("SELECT id, title, category, due_date, status, notes FROM tasks WHERE user_id = ? AND status <> 'done' ORDER BY due_date IS NULL, due_date LIMIT 40").all(r.user_id);
    const role = db.prepare("SELECT shift_role FROM users WHERE id = ?").get(r.user_id)?.shift_role;
    const items = role ? db.prepare("SELECT section, item_text FROM shift_checklist_templates WHERE role_name = ? ORDER BY sort_order").all(role) : [];
    const sections = []; for (const i of items) { let sec = sections.find((x) => x.section === i.section); if (!sec) sections.push(sec = { section: i.section, items: [] }); sec.items.push(i.item_text); }
    return { id: r.id, staffName: r.staff_name, fromDate: r.from_date, toDate: r.to_date, active: r.from_date <= t && r.to_date >= t, note: r.cover_note, roleName: role || null, tasks, sections };
  });
  res.json(out);
});

// ---- the leave letter (PDF) -------------------------------------------------------------------------------------------
router.get("/:id/letter.pdf", requireAuth, async (req, res) => {
  const r = db.prepare(withName + " WHERE l.id = ?").get(req.params.id);
  if (!r || !canSee(r, req.user.userId, req.user.roleName)) return res.status(404).json({ error: "Not found" });
  const chain = chainOf(r.id).map((c) => ({ ...c, label: LABEL_TEXT[c.label] || c.label, file: db.prepare("SELECT signature_file FROM leave_approvals WHERE leave_id = ? AND step = ?").get(r.id, c.step)?.signature_file }));
  const hrName = r.hr_confirmed_by ? db.prepare("SELECT name FROM users WHERE id = ?").get(r.hr_confirmed_by)?.name : null;
  const reason = REASONS.find((x) => x.key === r.reason_type)?.label || "";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="leave-letter-${r.staff_name.replace(/[^\w]+/g, "-")}-${r.from_date}.pdf"`);
  buildLeaveLetter({ r, reason, chain, hrName, applicantSig: r.applicant_signature && fs.existsSync(r.applicant_signature) ? r.applicant_signature : null }).pipe(res);
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
  mine.covering = db.prepare(withName + " WHERE l.cover_user_id = ? AND l.status = 'approved' AND l.to_date >= ? ORDER BY l.from_date").all(req.user.userId, t).map((r) => ({ id: r.id, staffName: r.staff_name, from_date: r.from_date, to_date: r.to_date, active: r.from_date <= t }));
  const out = { isHr: hr, mine };
  const approver = !!db.prepare("SELECT 1 FROM leave_approvals WHERE user_id = ? AND status = 'waiting'").get(req.user.userId);
  out.toSign = approver ? db.prepare(withName + " JOIN leave_approvals a ON a.leave_id = l.id AND a.user_id = ? AND a.status = 'waiting' AND a.step = l.step WHERE l.status = 'with_management'").all(req.user.userId) : [];
  // Other people's leave is private: only HR and the people who sign leave (COS, Director, Dr. Nishita) can see it.
  if (canSeeAllLeave(req.user.userId, req.user.roleName)) {
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
