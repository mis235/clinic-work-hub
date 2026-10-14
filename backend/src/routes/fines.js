import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { payslipExtras } from "./leave.js";

const router = Router();

// The usual reasons a clinic fines staff. Amounts are only suggestions: the person adding the fine can change them.
export const FINE_CATEGORIES = [
  { key: "late", label: "Late arrival", amount: 100 },
  { key: "dress_code", label: "Grooming / dress code", amount: 200 },
  { key: "misbehaviour", label: "Misbehaviour", amount: 500 },
  { key: "absent", label: "Absent without notice", amount: 500 },
  { key: "other", label: "Other", amount: 0 },
];

const isLead = (u) => u.roleName === "admin" || u.roleName === "manager";
const thisMonth = () => new Date(Date.now() + 19800000).toISOString().slice(0, 7);

/** Total fines for one person in a pay month ('YYYY-MM'). Used by payroll so fines come off the payslip. */
export function finesTotal(userId, period) {
  const r = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM fines WHERE user_id = ? AND substr(fine_date,1,7) = ?").get(userId, period);
  return r.t || 0;
}
/** A copy of the pay profile with this month's fines added to "other deductions". */
export function withFines(profile, period) {
  const { lop, lateCount } = payslipExtras(profile, period); // also brings the automatic late fines up to date
  const fines = finesTotal(profile.user_id, period);
  return { ...profile, fines, lop, lateCount, other_deductions: (profile.other_deductions || 0) + fines + lop.amount };
}

router.get("/categories", requireAuth, (req, res) => res.json(FINE_CATEGORIES));

// Admin/manager: all fines (filter ?month= & ?userId=). Staff: only their own.
router.get("/", requireAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : thisMonth();
  const lead = isLead(req.user);
  const userId = lead ? req.query.userId || null : req.user.userId;
  const rows = db.prepare(
    `SELECT f.*, u.name AS staff_name, d.name AS department, a.name AS added_by_name
     FROM fines f JOIN users u ON u.id = f.user_id LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users a ON a.id = f.added_by
     WHERE substr(f.fine_date,1,7) = ? ${userId ? "AND f.user_id = ?" : ""} ORDER BY f.fine_date DESC, f.created_at DESC`
  ).all(...(userId ? [month, userId] : [month]));
  res.json({ month, total: rows.reduce((s, r) => s + r.amount, 0), rows, categories: FINE_CATEGORIES });
});

// Per-person totals for the month (admin/manager).
router.get("/summary", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : thisMonth();
  const rows = db.prepare(
    `SELECT u.id, u.name, d.name AS department, COUNT(f.id) AS count, COALESCE(SUM(f.amount),0) AS total
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN fines f ON f.user_id = u.id AND substr(f.fine_date,1,7) = ?
     WHERE u.active = 1 GROUP BY u.id ORDER BY total DESC, u.name`
  ).all(month);
  res.json({ month, rows, total: rows.reduce((s, r) => s + r.total, 0) });
});

router.post("/", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Only admin or a manager can add a fine" });
  const { userId, category, amount, note, date } = req.body || {};
  const staff = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").get(userId);
  if (!staff) return res.status(400).json({ error: "Choose a staff member" });
  const cat = FINE_CATEGORIES.find((c) => c.key === category);
  if (!cat) return res.status(400).json({ error: "Choose a reason" });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 100000) return res.status(400).json({ error: "Enter a fine amount" });
  const fineDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const id = randomUUID();
  db.prepare("INSERT INTO fines (id, user_id, fine_date, category, amount, note, added_by) VALUES (?,?,?,?,?,?,?)")
    .run(id, staff.id, fineDate, cat.key, amt, note ? String(note).slice(0, 300) : null, req.user.userId);
  audit({ userId: req.user.userId, action: "FINE_ADDED", detail: `${staff.name} ${cat.key} ${amt}` });
  res.status(201).json(db.prepare("SELECT * FROM fines WHERE id = ?").get(id));
});

router.delete("/:id", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only admin can remove a fine" });
  const r = db.prepare("DELETE FROM fines WHERE id = ?").run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
