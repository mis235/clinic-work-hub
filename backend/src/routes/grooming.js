// Grooming book: like the paper register. Each month the admin / HR picks one or more staff to be the grooming inspectors.
// Only they (and the admin) can mark Morning / Afternoon grooming for everyone. A "no uniform" or "grooming" mark adds the
// grooming fine (once per person per day), which then comes off the payslip. The book can be downloaded and shared on WhatsApp.
import { Router } from "express";
import ExcelJS from "exceljs";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { audit } from "../audit.js";
import { tellStaff } from "./fines.js";

db.exec(`
CREATE TABLE IF NOT EXISTS grooming_assign (month TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (month, user_id));
CREATE TABLE IF NOT EXISTS grooming_marks (
  user_id TEXT NOT NULL, date TEXT NOT NULL, session TEXT NOT NULL, code TEXT NOT NULL, note TEXT, marked_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, date, session)
);`);

const router = Router();
export const CODES = [
  { key: "ok", label: "Neat", short: "✓", fine: false },
  { key: "late", label: "Late", short: "Late", fine: false },
  { key: "no_uniform", label: "No uniform", short: "NU", fine: true },
  { key: "grooming", label: "Grooming issue (nails / hair / footwear)", short: "G", fine: true },
  { key: "half_day", label: "Half day", short: "HD", fine: false },
  { key: "absent", label: "Absent", short: "Ab", fine: false },
  { key: "off", label: "Off / leave", short: "Off", fine: false },
];
const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const istMonth = () => istToday().slice(0, 7);
const goodMonth = (m) => (/^\d{4}-\d{2}$/.test(m || "") ? m : istMonth());
const fineAmount = () => { const r = db.prepare("SELECT value FROM app_settings WHERE key = 'groom_fine'").get(); const n = Number(r?.value); return Number.isFinite(n) && n > 0 ? n : 50; };
const canAssign = (req) => req.user.roleName === "admin" || accessFor(req.user.userId, req.user.roleName).isHr;
const isInspector = (req, month) => req.user.roleName === "admin" || !!db.prepare("SELECT 1 FROM grooming_assign WHERE month = ? AND user_id = ?").get(month, req.user.userId);
const people = () => db.prepare("SELECT u.id, u.name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND COALESCE(r.name,'') != 'admin' ORDER BY u.name").all();

// One grooming fine per person per day, whichever session had the problem. Removed again if the mark is corrected.
function syncFine(userId, date, byUser) {
  const id = `groom:${userId}:${date}`;
  const bad = db.prepare("SELECT session, code FROM grooming_marks WHERE user_id = ? AND date = ?").all(userId, date)
    .filter((m) => CODES.find((c) => c.key === m.code)?.fine);
  const have = db.prepare("SELECT id FROM fines WHERE id = ?").get(id);
  if (bad.length && !have) {
    const note = "Grooming book: " + bad.map((m) => `${CODES.find((c) => c.key === m.code).label} (${m.session === "AM" ? "morning" : "afternoon"})`).join(", ");
    db.prepare("INSERT INTO fines (id, user_id, fine_date, category, amount, note, added_by) VALUES (?,?,?,?,?,?,?)").run(id, userId, date, "dress_code", fineAmount(), note, byUser);
    tellStaff(userId, id, date, "Grooming / dress code", fineAmount(), note);
  } else if (!bad.length && have) db.prepare("DELETE FROM fines WHERE id = ?").run(id);
}

router.get("/book", requireAuth, (req, res) => {
  const month = goodMonth(req.query.month), [y, m] = month.split("-").map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const marks = {};
  for (const r of db.prepare("SELECT user_id, date, session, code, note FROM grooming_marks WHERE substr(date,1,7) = ?").all(month)) {
    ((marks[r.user_id] ||= {})[r.date] ||= {})[r.session] = { code: r.code, note: r.note || "" };
  }
  const assignees = db.prepare("SELECT u.id, u.name FROM grooming_assign g JOIN users u ON u.id = g.user_id WHERE g.month = ? ORDER BY u.name").all(month);
  res.json({ month, days, today: istToday(), staff: people(), marks, assignees, codes: CODES, fine: fineAmount(), canMark: isInspector(req, month), canAssign: canAssign(req) });
});

router.put("/assign", requireAuth, (req, res) => {
  if (!canAssign(req)) return res.status(403).json({ error: "Only the admin or HR can choose the grooming inspectors" });
  const month = goodMonth(req.body?.month), ids = [...new Set((req.body?.userIds || []).map(String))];
  const valid = ids.filter((id) => db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(id));
  db.prepare("DELETE FROM grooming_assign WHERE month = ?").run(month);
  const ins = db.prepare("INSERT INTO grooming_assign (month, user_id) VALUES (?, ?)");
  valid.forEach((id) => ins.run(month, id));
  audit({ userId: req.user.userId, action: "GROOMING_ASSIGNED", detail: `${month}: ${valid.length}` });
  res.json({ ok: true, count: valid.length });
});

router.put("/mark", requireAuth, (req, res) => {
  const { userId, date, session, code, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return res.status(400).json({ error: "Choose a date" });
  if (!["AM", "PM"].includes(session)) return res.status(400).json({ error: "Choose morning or afternoon" });
  if (!isInspector(req, date.slice(0, 7))) return res.status(403).json({ error: "Only this month's grooming inspectors can mark the book" });
  if (date > istToday()) return res.status(400).json({ error: "You cannot mark a future day" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a staff member" });
  if (userId === req.user.userId && req.user.roleName !== "admin") return res.status(403).json({ error: "You cannot mark your own grooming" });
  if (!code) db.prepare("DELETE FROM grooming_marks WHERE user_id = ? AND date = ? AND session = ?").run(userId, date, session);
  else {
    if (!CODES.some((c) => c.key === code)) return res.status(400).json({ error: "Unknown mark" });
    db.prepare(`INSERT INTO grooming_marks (user_id, date, session, code, note, marked_by) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, date, session) DO UPDATE SET code = excluded.code, note = excluded.note, marked_by = excluded.marked_by, updated_at = datetime('now')`)
      .run(userId, date, session, code, note ? String(note).slice(0, 120) : null, req.user.userId);
  }
  syncFine(userId, date, req.user.userId);
  res.json({ ok: true });
});

router.get("/export", requireAuth, async (req, res) => {
  const month = goodMonth(req.query.month), [y, m] = month.split("-").map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const marks = {};
  for (const r of db.prepare("SELECT user_id, date, session, code FROM grooming_marks WHERE substr(date,1,7) = ?").all(month)) ((marks[r.user_id] ||= {})[r.date] ||= {})[r.session] = r.code;
  const short = (k) => CODES.find((c) => c.key === k)?.short || "";
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Grooming " + month);
  const head = ["Sr", "Name"]; for (let d = 1; d <= days; d++) head.push(d + " AM", d + " PM"); head.push("Fines");
  ws.addRow(["Grooming book — " + new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })]).font = { bold: true, size: 14 };
  ws.addRow(head).font = { bold: true };
  people().forEach((p, i) => {
    const row = [i + 1, p.name]; let fines = 0;
    for (let d = 1; d <= days; d++) { const date = `${month}-${String(d).padStart(2, "0")}`; const mk = marks[p.id]?.[date] || {}; row.push(short(mk.AM), short(mk.PM)); if (CODES.some((c) => c.fine && (c.key === mk.AM || c.key === mk.PM))) fines++; }
    row.push(fines ? "₹" + fines * fineAmount() : "");
    ws.addRow(row);
  });
  ws.getColumn(2).width = 24; ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="grooming-${month}.xlsx"`);
  await wb.xlsx.write(res); res.end();
});

export default router;
