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


// ---- Doctors' rota: date ranges with a start time per doctor (like the paper roster: 10:00 and 10:30 slots) ----------
db.exec(`CREATE TABLE IF NOT EXISTS doctor_rota (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_date TEXT NOT NULL, to_date TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), start TEXT NOT NULL
);`);
const plusMin = (t, m) => { const [h, mi] = t.split(":").map(Number), x = h * 60 + mi + m; return `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
/** Start/end a doctor is rotated for on a date (null when the rota has nothing). A day is 9 h 30 min long. */
export function rotaFor(userId, date) {
  const r = db.prepare("SELECT start FROM doctor_rota WHERE user_id = ? AND ? BETWEEN from_date AND to_date ORDER BY id DESC LIMIT 1").get(userId, date);
  return r ? { start: r.start, end: plusMin(r.start, 570) } : null;
}
/** The shift a person works on a date, and where it came from: the weekly roster, the doctors' rota, or their usual hours. */
export function shiftOn(userId, date) {
  const w = baseShift(userId, date);
  if (!w.start) return w;
  const early = isMonday(date) ? Number(db.prepare("SELECT value FROM app_settings WHERE key = 'monday_early_min'").get()?.value ?? 30) : 0;
  return early ? { ...w, start: plusMin(w.start, -early), monday: true } : w;
}
const isMonday = (d) => new Date(d + "T00:00:00Z").getUTCDay() === 1;
function baseShift(userId, date) {
  const st = shiftFor(userId, date), t = st && getTypes()[st];
  if (st === "off") return { start: null, end: null, source: "off" };
  if (t && t.start) return { start: t.start, end: t.end, source: "roster" };
  const ro = rotaFor(userId, date);
  if (ro) return { ...ro, source: "rota" };
  const u = db.prepare("SELECT shift_start, shift_end FROM users WHERE id = ?").get(userId) || {};
  if (u.shift_start) return { start: u.shift_start, end: u.shift_end || plusMin(u.shift_start, 570), source: "usual" };
  return { start: null, end: null, source: "none" };
}
export const fmtTime = (t) => (t ? fmt12(t) : "");
export const fmtRange = (w) => (w && w.start ? `${fmt12(w.start)} – ${fmt12(w.end)}` : "");

const bnorm = (x) => String(x || "").toLowerCase().replace(/^dr\.?\s*/, "").replace(/[^a-z ]/g, "").replace(/ksh/g, "x").replace(/sh/g, "s").replace(/th/g, "t").replace(/ph/g, "f").replace(/(.)\1+/g, "$1").trim();
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
/** Finds the staff member a typed name means (spelling variants allowed). Returns the user row or null. */
export function matchStaff(name, staff) {
  const n = bnorm(name); if (!n) return null;
  const first = (x) => bnorm(x).split(" ")[0];
  const exact = staff.filter((u) => bnorm(u.name) === n); if (exact.length === 1) return exact[0];
  const f = staff.filter((u) => first(u.name) === first(name)); if (f.length === 1) return f[0];
  if (n.length >= 5) { const near = staff.filter((u) => lev(first(u.name), first(name)) <= 1); if (near.length === 1) return near[0]; }
  return null;
}
const activeStaff = () => db.prepare("SELECT u.id, u.name, u.designation, u.shift_start, u.shift_end, (u.photo_path IS NOT NULL) AS has_photo, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 ORDER BY d.name, u.name").all();
function ensureType(start, end) {
  const have = db.prepare("SELECT key FROM shift_types WHERE start = ? AND end = ?").get(start, end);
  if (have) return have.key;
  const key = "s" + start.replace(":", "") + "_" + end.replace(":", "");
  db.prepare("INSERT OR IGNORE INTO shift_types (key, label, start, end) VALUES (?,?,?,?)").run(key, autoLabel(start, end), start, end);
  return key;
}
const to24 = (h, m, ap) => { let H = Number(h) % 12; if (/p/i.test(ap)) H += 12; return `${String(H).padStart(2, "0")}:${String(m || "00").padStart(2, "0")}`; };
/** Reads lines like "Jyothi – 10:00 AM to 6:30 PM" (headings and blank lines are skipped). */
export function parseShiftText(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*([^\d]+?)\s*[-–—:]\s*(\d{1,2})[:.](\d{2})?\s*([ap]m)?\s*(?:to|-|–|—)\s*(\d{1,2})[:.](\d{2})?\s*([ap]m)\s*$/i.exec(line);
    if (!m) continue;
    const ap1 = m[4] || (Number(m[2]) >= 7 && Number(m[2]) <= 11 ? "am" : m[7]);
    out.push({ name: m[1].trim(), start: to24(m[2], m[3], ap1), end: to24(m[5], m[6], m[7]) });
  }
  return out;
}
function applyTimes(items, save) {
  const staff = activeStaff(), result = [];
  for (const it of items) {
    const u = matchStaff(it.name, staff);
    if (u && save) { db.prepare("UPDATE users SET shift_start = ?, shift_end = ? WHERE id = ?").run(it.start, it.end, u.id); ensureType(it.start, it.end); }
    result.push({ typed: it.name, start: it.start, end: it.end, label: autoLabel(it.start, it.end), userId: u?.id || null, name: u?.name || null });
  }
  return result;
}

// The clinic's own list of shift times. Only people with no hours yet are filled in, so edits by the admin are never overwritten.
const CLINIC_TIMES = `Jyothi – 10:00 AM to 6:30 PM
Kavya – 10:00 AM to 7:30 PM
Prathyusha – 9:30 AM to 7:00 PM
Amena – 8:30 AM to 6:00 PM
Geetha – 9:30 AM to 7:00 PM
Chun – 9:30 AM to 7:00 PM
Gracy – 9:30 AM to 7:00 PM
Pari – 9:30 AM to 7:00 PM
Kajal Kumari – 9:30 AM to 7:00 PM
Anusha – 10:00 AM to 7:30 PM
Priyanaka – 9:00 AM to 6:30 PM
Asif – 10:00 AM to 7:30 PM
Naga – 9:00 AM to 6:30 PM
Neelima – 9:00 AM to 6:30 PM
Monika – 9:00 AM to 6:30 PM
Pavani – 8:30 AM to 6:00 PM
Lakshmi – 8:30 AM to 6:00 PM
Sivama – 6:00 PM to 8:00 PM`;
export function seedClinicTimes() {
  const staff = activeStaff().filter((u) => !u.shift_start);
  let hit = 0;
  for (const it of parseShiftText(CLINIC_TIMES)) { const u = matchStaff(it.name, staff); if (u) { hit++; db.prepare("UPDATE users SET shift_start = ?, shift_end = ? WHERE id = ?").run(it.start, it.end, u.id); ensureType(it.start, it.end); } }
  // The doctors' rota from the paper roster (10:00 / 10:30 slots, fortnight by fortnight).
  if (!db.prepare("SELECT 1 FROM doctor_rota").get()) {
    const docs = activeStaff().filter((u) => /^dr\b/i.test(u.name.trim()));
    const pick = (n) => matchStaff(n, docs) || matchStaff(n === "Siri" ? "Shirisha" : n, docs);
    const [siri, bhavi, arshiya] = ["Siri", "Bhavi", "Arshiya"].map(pick);
    const Y = new Date(Date.now() + 19800000).getUTCFullYear();
    const blocks = [["10-07", "10-20", [siri, bhavi], arshiya], ["10-21", "11-03", [bhavi, arshiya], siri], ["11-04", "11-17", [siri, arshiya], bhavi], ["11-18", "12-01", [siri, bhavi], arshiya]];
    const ins = db.prepare("INSERT INTO doctor_rota (from_date, to_date, user_id, start) VALUES (?,?,?,?)");
    for (const [a, b, ten, half] of blocks) { for (const d of ten) if (d) ins.run(`${Y}-${a}`, `${Y}-${b}`, d.id, "10:00"); if (half) ins.run(`${Y}-${a}`, `${Y}-${b}`, half.id, "10:30"); }
  }
}
seedClinicTimes();

// Admin/manager: everyone's usual hours, the doctors' rota and who is not in the app yet.
router.get("/times", requireAuth, (req, res) => {
  seedClinicTimes();
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  res.json({ rows: activeStaff().map((u) => ({ id: u.id, name: u.name, designation: u.designation || "", department: u.department || "", hasPhoto: !!u.has_photo, start: u.shift_start || "", end: u.shift_end || "", label: u.shift_start ? autoLabel(u.shift_start, u.shift_end || plusMin(u.shift_start, 570)) : "" })) });
});
router.put("/times/:id", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { start, end } = req.body || {};
  if (!start && !end) { db.prepare("UPDATE users SET shift_start = NULL, shift_end = NULL WHERE id = ?").run(req.params.id); return res.json({ ok: true }); }
  if (!HHMM.test(start || "") || !HHMM.test(end || "") || end <= start) return res.status(400).json({ error: "Check the start and end times" });
  db.prepare("UPDATE users SET shift_start = ?, shift_end = ? WHERE id = ?").run(start, end, req.params.id); ensureType(start, end);
  res.json({ ok: true });
});
// Paste the list ("Name – 10:00 AM to 6:30 PM" per line): preview first, then save.
router.post("/times/import", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const items = parseShiftText(req.body?.text);
  if (!items.length) return res.status(400).json({ error: "No shift lines found. Use: Name – 10:00 AM to 6:30 PM" });
  const result = applyTimes(items, !!req.body?.apply);
  res.json({ applied: !!req.body?.apply, result, missing: result.filter((r) => !r.userId).map((r) => r.typed) });
});

router.get("/doctor-rota", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const rows = db.prepare("SELECT r.*, u.name FROM doctor_rota r JOIN users u ON u.id = r.user_id ORDER BY r.from_date, r.start, u.name").all();
  const blocks = [];
  for (const r of rows) {
    let b = blocks.find((x) => x.from === r.from_date && x.to === r.to_date); if (!b) blocks.push((b = { from: r.from_date, to: r.to_date, slots: {} }));
    (b.slots[r.start] = b.slots[r.start] || []).push({ id: r.id, userId: r.user_id, name: r.name });
  }
  const doctors = activeStaff().filter((u) => u.department === "Doctors" || /^dr\b/i.test(u.name.trim())).map((u) => ({ id: u.id, name: u.name }));
  res.json({ blocks, doctors, today: today() });
});
router.post("/doctor-rota", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const { from, to, userId, start } = req.body || {};
  if (!DATE.test(from || "") || !DATE.test(to || "") || to < from) return res.status(400).json({ error: "Check the dates" });
  if (!HHMM.test(start || "")) return res.status(400).json({ error: "Choose the start time" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a doctor" });
  db.prepare("DELETE FROM doctor_rota WHERE user_id = ? AND from_date = ? AND to_date = ?").run(userId, from, to);
  db.prepare("INSERT INTO doctor_rota (from_date, to_date, user_id, start) VALUES (?,?,?,?)").run(from, to, userId, start);
  res.status(201).json({ ok: true });
});
router.delete("/doctor-rota/:id", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  db.prepare("DELETE FROM doctor_rota WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// One person's shifts for the next days, from every source (used on dashboards).
export function upcomingFor(userId, n = 7) {
  const t = today();
  return Array.from({ length: n }, (_, i) => { const date = addDays(t, i), w = shiftOn(userId, date); return { date, start: w.start, end: w.end, label: fmtRange(w), source: w.source }; });
}

// Staff: my shifts for the next 7 days.
router.get("/me", requireAuth, (req, res) => {
  const t = today();
  const rows = db.prepare("SELECT shift_date, shift_type FROM shifts WHERE user_id = ? AND shift_date BETWEEN ? AND ? ORDER BY shift_date").all(req.user.userId, t, addDays(t, 6));
  res.json({ today: rows.find((r) => r.shift_date === t)?.shift_type || null, types: getTypes(), days: rows, upcoming: upcomingFor(req.user.userId, 7) });
});

export default router;
