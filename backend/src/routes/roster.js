import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Shift types and their start/end (India time). "late" is measured from the start of the person's shift that day.
export const SHIFT_TYPES = {
  morning: { label: "Morning", start: "09:30", end: "17:30" },
  evening: { label: "Evening", start: "13:30", end: "21:00" },
  general: { label: "General", start: "10:00", end: "19:00" },
  off: { label: "Day off", start: null, end: null },
};
const isLead = (u) => u.roleName === "admin" || u.roleName === "manager";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (d) => { const wd = new Date(d + "T00:00:00Z").getUTCDay(); return addDays(d, -((wd + 6) % 7)); };

db.exec(`CREATE TABLE IF NOT EXISTS shifts (
  user_id TEXT NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  PRIMARY KEY (user_id, shift_date)
);`);

/** Rostered shift type for one person/day, or null when nothing is planned. */
export function shiftFor(userId, date) {
  return db.prepare("SELECT shift_type FROM shifts WHERE user_id = ? AND shift_date = ?").get(userId, date)?.shift_type || null;
}

router.get("/types", requireAuth, (req, res) => res.json(SHIFT_TYPES));

// Lead: a week of shifts for everyone (?start=any date in the week).
router.get("/week", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const start = mondayOf(DATE.test(req.query.start || "") ? req.query.start : today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const staff = db.prepare("SELECT u.id, u.name, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 ORDER BY d.name, u.name").all();
  const set = db.prepare("SELECT user_id, shift_date, shift_type FROM shifts WHERE shift_date BETWEEN ? AND ?").all(days[0], days[6]);
  const by = new Map(set.map((r) => [r.user_id + "|" + r.shift_date, r.shift_type]));
  res.json({ start, days, types: SHIFT_TYPES, rows: staff.map((u) => ({ ...u, shifts: days.map((d) => by.get(u.id + "|" + d) || "") })) });
});

router.put("/", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { userId, date, shift } = req.body || {};
  if (!DATE.test(date || "")) return res.status(400).json({ error: "Bad date" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a staff member" });
  if (!shift) db.prepare("DELETE FROM shifts WHERE user_id = ? AND shift_date = ?").run(userId, date);
  else if (!SHIFT_TYPES[shift]) return res.status(400).json({ error: "Unknown shift" });
  else db.prepare("INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?) ON CONFLICT(user_id, shift_date) DO UPDATE SET shift_type = excluded.shift_type").run(userId, date, shift);
  res.json({ ok: true });
});

// Lead: copy one week's plan onto another (fills the next week in one click).
router.post("/copy-week", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { from, to } = req.body || {};
  if (!DATE.test(from || "") || !DATE.test(to || "")) return res.status(400).json({ error: "Bad date" });
  const a = mondayOf(from), b = mondayOf(to);
  const rows = db.prepare("SELECT * FROM shifts WHERE shift_date BETWEEN ? AND ?").all(a, addDays(a, 6));
  const ins = db.prepare("INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?) ON CONFLICT(user_id, shift_date) DO UPDATE SET shift_type = excluded.shift_type");
  db.transaction(() => rows.forEach((r) => ins.run(r.user_id, addDays(b, Math.round((new Date(r.shift_date) - new Date(a)) / 86400000)), r.shift_type)))();
  res.json({ ok: true, copied: rows.length });
});

// Staff: my shifts for the next 7 days.
router.get("/me", requireAuth, (req, res) => {
  const t = today();
  const rows = db.prepare("SELECT shift_date, shift_type FROM shifts WHERE user_id = ? AND shift_date BETWEEN ? AND ? ORDER BY shift_date").all(req.user.userId, t, addDays(t, 6));
  res.json({ today: rows.find((r) => r.shift_date === t)?.shift_type || null, types: SHIFT_TYPES, days: rows });
});

export default router;
