import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const IST = "'+5 hours', '+30 minutes'";
const istDay = (col) => `date(${col}, ${IST})`;
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const isLead = (u) => u.roleName === "admin" || u.roleName === "manager";
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

// One department's numbers for the last 30 days (shared by the overview and the detail view).
function deptStats(deptId, month, since) {
  const staff = db.prepare("SELECT id FROM users WHERE active = 1 AND department_id = ?").all(deptId);
  const ids = staff.map((s) => s.id);
  if (!ids.length) return { staff: 0, present_today: 0, completion_pct: null, tasks_open: 0, documents: 0, fines_month: 0 };
  const q = ids.map(() => "?").join(",");
  const present = db.prepare(`SELECT COUNT(DISTINCT user_id) n FROM attendance WHERE type='check_in' AND ${istDay("recorded_at")} = ? AND user_id IN (${q})`).get(today(), ...ids).n;
  const sc = db.prepare(`SELECT COALESCE(SUM(completed),0) d, COALESCE(SUM(total),0) t FROM shift_checklist_submissions WHERE work_date >= ? AND user_id IN (${q})`).get(since, ...ids);
  const tk = db.prepare(`SELECT COALESCE(SUM(status='done'),0) d, COUNT(*) t, COALESCE(SUM(status!='done'),0) o FROM tasks WHERE user_id IN (${q}) AND date(created_at) >= ?`).get(...ids, since);
  const docs = db.prepare("SELECT COUNT(*) n FROM documents WHERE department_id = ? AND staff_user_id IS NULL").get(deptId).n;
  const fines = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM fines WHERE substr(fine_date,1,7) = ? AND user_id IN (${q})`).get(month, ...ids).n;
  return { staff: ids.length, present_today: present, completion_pct: pct(sc.d + tk.d, sc.t + tk.t), tasks_open: tk.o, documents: docs, fines_month: fines };
}
const sinceDate = () => new Date(Date.now() + 19800000 - 29 * 86400000).toISOString().slice(0, 10);

// Admin/manager: every department as a card with its numbers.
router.get("/departments", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const month = today().slice(0, 7), since = sinceDate();
  const depts = db.prepare("SELECT id, name FROM departments ORDER BY name").all();
  res.json({ month, rows: depts.map((d) => ({ ...d, ...deptStats(d.id, month, since) })).filter((d) => d.staff > 0) });
});

// One department: its people (today's status, completion, fines) and its documents.
router.get("/departments/:id", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Not allowed" });
  const dept = db.prepare("SELECT id, name FROM departments WHERE id = ?").get(req.params.id);
  if (!dept) return res.status(404).json({ error: "Not found" });
  const month = today().slice(0, 7), since = sinceDate();
  const people = db.prepare("SELECT id, name, designation FROM users WHERE active = 1 AND department_id = ? ORDER BY name").all(dept.id).map((u) => {
    const first = db.prepare(`SELECT MIN(recorded_at) t FROM attendance WHERE user_id = ? AND type='check_in' AND ${istDay("recorded_at")} = ?`).get(u.id, today()).t;
    const sc = db.prepare("SELECT COALESCE(SUM(completed),0) d, COALESCE(SUM(total),0) t FROM shift_checklist_submissions WHERE user_id = ? AND work_date >= ?").get(u.id, since);
    const tk = db.prepare("SELECT COALESCE(SUM(status='done'),0) d, COUNT(*) t FROM tasks WHERE user_id = ? AND date(created_at) >= ?").get(u.id, since);
    const fines = db.prepare("SELECT COALESCE(SUM(amount),0) n FROM fines WHERE user_id = ? AND substr(fine_date,1,7) = ?").get(u.id, month).n;
    return { ...u, first_in: first, completion_pct: pct(sc.d + tk.d, sc.t + tk.t), fines_month: fines };
  });
  const documents = db.prepare(
    `SELECT dc.id, dc.title, dc.category, dc.kind, dc.url, dc.file_name, dc.created_at, u.name AS uploaded_by_name
     FROM documents dc LEFT JOIN users u ON u.id = dc.uploaded_by WHERE dc.department_id = ? AND dc.staff_user_id IS NULL ORDER BY dc.created_at DESC LIMIT 100`).all(dept.id);
  res.json({ department: dept, stats: deptStats(dept.id, month, since), people, documents });
});

// Staff: a one-screen summary of "my day".
router.get("/me", requireAuth, (req, res) => {
  const id = req.user.userId, month = today().slice(0, 7), since = sinceDate();
  const recs = db.prepare(`SELECT type, recorded_at FROM attendance WHERE user_id = ? AND ${istDay("recorded_at")} = ? ORDER BY recorded_at`).all(id, today());
  const tk = db.prepare("SELECT COALESCE(SUM(status='done'),0) d, COUNT(*) t, COALESCE(SUM(status!='done'),0) o FROM tasks WHERE user_id = ?").get(id);
  const sc = db.prepare("SELECT COALESCE(SUM(completed),0) d, COALESCE(SUM(total),0) t FROM shift_checklist_submissions WHERE user_id = ? AND work_date >= ?").get(id, since);
  const myDocs = db.prepare("SELECT COUNT(*) n FROM documents WHERE uploaded_by = ? AND staff_user_id IS NULL").get(id).n;
  const fines = db.prepare("SELECT COALESCE(SUM(amount),0) n, COUNT(*) c FROM fines WHERE user_id = ? AND substr(fine_date,1,7) = ?").get(id, month);
  const days = db.prepare(`SELECT COUNT(DISTINCT ${istDay("recorded_at")}) n FROM attendance WHERE user_id = ? AND type='check_in' AND substr(${istDay("recorded_at")},1,7) = ?`).get(id, month).n;
  res.json({
    checked_in: recs.some((r) => r.type === "check_in"), first_in: recs.find((r) => r.type === "check_in")?.recorded_at || null,
    tasks_open: tk.o, completion_pct: pct(sc.d + tk.d, sc.t + tk.t), my_documents: myDocs,
    fines_month: fines.n, fines_count: fines.c, days_present: days, month,
  });
});

export default router;
