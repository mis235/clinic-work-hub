import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Shift types are set by the admin (start/end in India time). "Day off" is built in.
// "late" is measured from the start of the person's shift that day.
db.exec(`CREATE TABLE IF NOT EXISTS shift_types (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
);`);
const fmt12 = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const autoLabel = (st, en) => `${fmt12(st)} – ${fmt12(en)}`;
if (!db.prepare("SELECT 1 FROM shift_types").get()) {
  const ins = db.prepare("INSERT INTO shift_types (key, label, start, end, sort_order) VALUES (?,?,?,?,?)");
  [["09:00", "18:30"], ["09:30", "19:00"], ["10:00", "19:30"]].forEach(([st, en], i) => ins.run("s" + st.replace(":", ""), autoLabel(st, en), st, en, i));
}
export function getTypes() {
  const o = {};
  for (const r of db.prepare("SELECT * FROM shift_types ORDER BY start, end").all()) o[r.key] = { label: r.label, start: r.start, end: r.end };
  o.off = { label: "Day off", start: null, end: null };
  return o;
}
export const SHIFT_TYPES = new Proxy({}, { get: (_, k) => getTypes()[k] }); // kept for older imports
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

// Earlier versions used fixed names; move any existing assignments to the new shifts.
for (const [o, n] of [["morning", "s0900"], ["general", "s1000"], ["evening", "s0930"]]) db.prepare("UPDATE shifts SET shift_type = ? WHERE shift_type = ? AND EXISTS (SELECT 1 FROM shift_types WHERE key = ?)").run(n, o, n);
/** Rostered shift type for one person/day, or null when nothing is planned. */
export function shiftFor(userId, date) {
  return db.prepare("SELECT shift_type FROM shifts WHERE user_id = ? AND shift_date = ?").get(userId, date)?.shift_type || null;
}

router.get("/types", requireAuth, (req, res) => res.json(getTypes()));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Admin: add a shift (e.g. 09:00 to 18:30).
router.post("/types", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only admin can create shifts" });
  const { start, end, label } = req.body || {};
  if (!HHMM.test(start || "") || !HHMM.test(end || "")) return res.status(400).json({ error: "Enter start and end times" });
  if (end <= start) return res.status(400).json({ error: "End time must be after the start time" });
  const key = "s" + start.replace(":", "") + "_" + end.replace(":", "");
  if (db.prepare("SELECT 1 FROM shift_types WHERE start = ? AND end = ?").get(start, end)) return res.status(409).json({ error: "That shift already exists" });
  db.prepare("INSERT INTO shift_types (key, label, start, end) VALUES (?,?,?,?)").run(key, (label && String(label).trim().slice(0, 40)) || autoLabel(start, end), start, end);
  res.status(201).json(getTypes());
});
router.patch("/types/:key", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only admin can change shifts" });
  const cur = db.prepare("SELECT * FROM shift_types WHERE key = ?").get(req.params.key);
  if (!cur) return res.status(404).json({ error: "Not found" });
  const start = req.body?.start ?? cur.start, end = req.body?.end ?? cur.end;
  if (!HHMM.test(start) || !HHMM.test(end) || end <= start) return res.status(400).json({ error: "Check the start and end times" });
  const label = req.body?.label ? String(req.body.label).trim().slice(0, 40) : autoLabel(start, end);
  db.prepare("UPDATE shift_types SET label = ?, start = ?, end = ? WHERE key = ?").run(label, start, end, cur.key);
  res.json(getTypes());
});
router.delete("/types/:key", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only admin can remove shifts" });
  const n = db.prepare("SELECT COUNT(*) n FROM shifts WHERE shift_type = ? AND shift_date >= ?").get(req.params.key, today()).n;
  if (n) return res.status(409).json({ error: `${n} upcoming assignment(s) use this shift. Change those first.` });
  db.prepare("DELETE FROM shift_types WHERE key = ?").run(req.params.key);
  res.json(getTypes());
});

// Lead: give one person the same shift on several days (e.g. Mon-Sat).
router.put("/bulk", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { userId, dates, shift } = req.body || {};
  if (!Array.isArray(dates) || !dates.length || dates.length > 31 || !dates.every((d) => DATE.test(d))) return res.status(400).json({ error: "Bad dates" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a staff member" });
  if (shift && !getTypes()[shift]) return res.status(400).json({ error: "Unknown shift" });
  db.transaction(() => dates.forEach((d) => shift
    ? db.prepare("INSERT INTO shifts (user_id, shift_date, shift_type) VALUES (?,?,?) ON CONFLICT(user_id, shift_date) DO UPDATE SET shift_type = excluded.shift_type").run(userId, d, shift)
    : db.prepare("DELETE FROM shifts WHERE user_id = ? AND shift_date = ?").run(userId, d)))();
  res.json({ ok: true });
});

// Lead: a week of shifts for everyone (?start=any date in the week).
router.get("/week", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const start = mondayOf(DATE.test(req.query.start || "") ? req.query.start : today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const staff = db.prepare("SELECT u.id, u.name, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 ORDER BY d.name, u.name").all();
  const set = db.prepare("SELECT user_id, shift_date, shift_type FROM shifts WHERE shift_date BETWEEN ? AND ?").all(days[0], days[6]);
  const by = new Map(set.map((r) => [r.user_id + "|" + r.shift_date, r.shift_type]));
  res.json({ start, days, types: getTypes(), rows: staff.map((u) => ({ ...u, shifts: days.map((d) => by.get(u.id + "|" + d) || "") })) });
});

router.put("/", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { userId, date, shift } = req.body || {};
  if (!DATE.test(date || "")) return res.status(400).json({ error: "Bad date" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a staff member" });
  if (!shift) db.prepare("DELETE FROM shifts WHERE user_id = ? AND shift_date = ?").run(userId, date);
  else if (!getTypes()[shift]) return res.status(400).json({ error: "Unknown shift" });
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
  res.json({ today: rows.find((r) => r.shift_date === t)?.shift_type || null, types: getTypes(), days: rows });
});

export default router;
