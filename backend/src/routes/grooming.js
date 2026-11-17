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
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Grooming " + month, { pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }, views: [{ state: "frozen", xSplit: 2, ySplit: 5 }] });
  const mName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const lastCol = 2 + days * 2 + 2, thin = { style: "thin", color: { argb: "FFD9C2D3" } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const PINK = "FFC42F8F", SOFT = "FFFDE6F3", RED = "FFFEE2E2", GREEN = "FFDCFCE7", AMBER = "FFFEF3C7", GREY = "FFE5E7EB";
  const FILL = { ok: GREEN, late: AMBER, no_uniform: RED, grooming: RED, half_day: AMBER, absent: RED, off: GREY };
  ws.mergeCells(1, 1, 1, lastCol); ws.getCell(1, 1).value = "DR. NISHITA'S CLINIC — FOR SKIN, HAIR & AESTHETICS";
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } }; ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PINK } }; ws.getCell(1, 1).alignment = { vertical: "middle", horizontal: "left", indent: 1 }; ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, lastCol); ws.getCell(2, 1).value = `Grooming Book — ${mName}`; ws.getCell(2, 1).font = { bold: true, size: 13 }; ws.getCell(2, 1).alignment = { indent: 1 };
  const insp = db.prepare("SELECT u.name FROM grooming_assign g JOIN users u ON u.id = g.user_id WHERE g.month = ? ORDER BY u.name").all(month).map((r) => r.name);
  ws.mergeCells(3, 1, 3, lastCol); ws.getCell(3, 1).value = `Inspector(s): ${insp.join(", ") || "—"}     Fine for no uniform / grooming issue: ₹${fineAmount()} per person per day`; ws.getCell(3, 1).font = { size: 10.5, color: { argb: "FF6F5E82" } }; ws.getCell(3, 1).alignment = { indent: 1 };
  ws.mergeCells(4, 1, 4, lastCol); ws.getCell(4, 1).value = "Key:  ✓ Neat   " + CODES.filter((c) => c.key !== "ok").map((c) => `${c.short} = ${c.label}`).join("   "); ws.getCell(4, 1).font = { size: 10, italic: true, color: { argb: "FF6F5E82" } }; ws.getCell(4, 1).alignment = { indent: 1 };
  const hr = ws.getRow(5), hd = ["Sr", "Name"]; for (let d = 1; d <= days; d++) hd.push(String(d), ""); hd.push("Marks", "Fine (₹)");
  hr.values = hd; for (let d = 0; d < days; d++) ws.mergeCells(5, 3 + d * 2, 5, 4 + d * 2);
  hr.height = 20; hr.eachCell((c) => { c.font = { bold: true, color: { argb: "FF4A1D3F" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; c.alignment = { horizontal: "center", vertical: "middle" }; c.border = box; });
  const sub = ws.addRow(["", ""].concat(Array.from({ length: days }, () => ["AM", "PM"]).flat(), ["", ""]));
  sub.eachCell((c) => { c.font = { size: 8.5, color: { argb: "FF6F5E82" } }; c.alignment = { horizontal: "center" }; c.border = box; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7FB" } }; });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 6 }];
  people().forEach((p, i) => {
    const row = [i + 1, p.name]; let fineDays = 0, bad = 0;
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`, mk = marks[p.id]?.[date] || {};
      row.push(mk.AM ? (mk.AM === "ok" ? "✓" : short(mk.AM)) : "", mk.PM ? (mk.PM === "ok" ? "✓" : short(mk.PM)) : "");
      if (CODES.some((c) => c.fine && (c.key === mk.AM || c.key === mk.PM))) fineDays++;
      for (const k of [mk.AM, mk.PM]) if (k && k !== "ok") bad++;
    }
    row.push(bad || "", fineDays ? fineDays * fineAmount() : "");
    const r = ws.addRow(row);
    r.eachCell((c, col) => { c.border = box; c.alignment = { horizontal: col === 2 ? "left" : "center", vertical: "middle" }; c.font = { size: col <= 2 ? 11 : 10, bold: col === 2 }; });
    for (let d = 1; d <= days; d++) { const date = `${month}-${String(d).padStart(2, "0")}`, mk = marks[p.id]?.[date] || {};
      [["AM", 3 + (d - 1) * 2], ["PM", 4 + (d - 1) * 2]].forEach(([ses, col]) => { const k = mk[ses]; if (k) { const c = r.getCell(col); c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[k] || GREY } }; c.font = { size: 10, bold: k !== "ok", color: { argb: k === "ok" ? "FF166534" : "FF7F1D1D" } }; } }); }
    if (fineDays) r.getCell(lastCol).font = { bold: true, color: { argb: "FFB91C1C" } };
  });
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 26;
  for (let c = 3; c <= 2 + days * 2; c++) ws.getColumn(c).width = 3.6;
  ws.getColumn(lastCol - 1).width = 8; ws.getColumn(lastCol).width = 11;
  const foot = ws.addRow([]); const fr = ws.rowCount + 1;
  ws.mergeCells(fr, 1, fr, lastCol); ws.getCell(fr, 1).value = `Generated from Clinic Work Hub on ${new Date(Date.now() + 19800000).toISOString().slice(0, 16).replace("T", " ")} IST`; ws.getCell(fr, 1).font = { size: 9, italic: true, color: { argb: "FF9A8AA3" } };
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="grooming-${month}.xlsx"`);
  await wb.xlsx.write(res); res.end();
});

export default router;
