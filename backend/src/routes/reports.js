import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

// GET /api/reports/summary — everything built from data the app already has.
// No new input from admin needed; this is pure aggregation.
router.get("/summary", requireAuth, requirePermission("reports:view"), (req, res) => {
  // Task completion by department
  const taskByDept = db
    .prepare(
      `SELECT d.name AS department,
              COUNT(*) AS total,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN t.status IN ('sent','accepted','in_progress') AND t.due_date IS NOT NULL AND t.due_date < datetime('now') THEN 1 ELSE 0 END) AS overdue
       FROM tasks t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       GROUP BY d.name
       ORDER BY d.name`
    )
    .all();

  // Task completion by individual staff member
  const taskByStaff = db
    .prepare(
      `SELECT u.name, d.name AS department,
              COUNT(*) AS total,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       GROUP BY u.id
       ORDER BY d.name, u.name`
    )
    .all();

  // Attendance summary — check-ins in the last 30 days per staff member
  const attendanceSummary = db
    .prepare(
      `SELECT u.name, d.name AS department,
              SUM(CASE WHEN a.type = 'check_in' THEN 1 ELSE 0 END) AS check_ins,
              SUM(CASE WHEN a.method = 'manual' THEN 1 ELSE 0 END) AS manual_entries
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE a.recorded_at >= datetime('now', '-30 days')
       GROUP BY u.id
       ORDER BY d.name, u.name`
    )
    .all();

  // Policy acknowledgment gaps — staff who haven't acknowledged the CURRENT
  // version of at least one policy. This turns "everyone should have read this"
  // into something admin can actually verify.
  const policies = db.prepare("SELECT id, title, version FROM policies").all();
  const activeUsers = db.prepare("SELECT id, name FROM users WHERE active = 1").all();
  const policyGaps = policies.map((p) => {
    const acked = new Set(
      db
        .prepare("SELECT user_id FROM policy_acknowledgments WHERE policy_id = ? AND policy_version = ?")
        .all(p.id, p.version)
        .map((r) => r.user_id)
    );
    const missing = activeUsers.filter((u) => !acked.has(u.id)).map((u) => u.name);
    return { title: p.title, version: p.version, missingCount: missing.length, missing };
  });

  // Shift-checklist completion (the daily Opening / During-day / End-of-day lists, incl. imported history)
  // combined with admin-assigned tasks => ONE completion picture. Counted per checklist ITEM and per task.
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() + 19800000 - days * 86400000).toISOString().slice(0, 10);
  const checklistByStaff = db
    .prepare(
      `SELECT u.id AS user_id, u.name, d.name AS department,
              COUNT(*) AS submissions, SUM(s.completed) AS items_done, SUM(s.total) AS items_total
       FROM shift_checklist_submissions s JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE s.work_date >= ? GROUP BY u.id ORDER BY d.name, u.name`
    ).all(since);
  const taskCountsByUser = new Map(
    db.prepare(`SELECT user_id, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM tasks WHERE created_at >= ? GROUP BY user_id`)
      .all(since).map((r) => [r.user_id, r])
  );
  const people = new Map();
  for (const r of checklistByStaff) people.set(r.user_id, { ...r, tasks_done: 0, tasks_total: 0 });
  for (const [uid, t] of taskCountsByUser) {
    if (!people.has(uid)) {
      const u = db.prepare("SELECT u.id AS user_id, u.name, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?").get(uid);
      if (u) people.set(uid, { ...u, submissions: 0, items_done: 0, items_total: 0, tasks_done: 0, tasks_total: 0 });
    }
    const p = people.get(uid); if (p) { p.tasks_done = t.done; p.tasks_total = t.total; }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const completionByStaff = [...people.values()].map((p) => ({
    ...p, combined_done: p.items_done + p.tasks_done, combined_total: p.items_total + p.tasks_total,
    completion_pct: pct(p.items_done + p.tasks_done, p.items_total + p.tasks_total),
  }));
  const deptMap = new Map();
  for (const p of completionByStaff) {
    const k = p.department || "Unassigned";
    const d = deptMap.get(k) || { department: k, combined_done: 0, combined_total: 0, submissions: 0, tasks_done: 0, tasks_total: 0 };
    d.combined_done += p.combined_done; d.combined_total += p.combined_total; d.submissions += p.submissions; d.tasks_done += p.tasks_done; d.tasks_total += p.tasks_total;
    deptMap.set(k, d);
  }
  const completionByDept = [...deptMap.values()].map((d) => ({ ...d, completion_pct: pct(d.combined_done, d.combined_total) }));
  const trendRows = db.prepare(
    `SELECT work_date AS date, SUM(completed) AS done, SUM(total) AS total, COUNT(*) AS submissions
     FROM shift_checklist_submissions WHERE work_date >= ? GROUP BY work_date ORDER BY work_date`).all(since);
  const completionTrend = trendRows.map((r) => ({ ...r, completion_pct: pct(r.done, r.total) }));
  const totals = completionByStaff.reduce((a, p) => ({ done: a.done + p.combined_done, total: a.total + p.combined_total }), { done: 0, total: 0 });
  const completion = { days, since, overall_pct: pct(totals.done, totals.total), done: totals.done, total: totals.total };

  res.json({ taskByDept, taskByStaff, attendanceSummary, policyGaps, completion, completionByDept, completionByStaff, completionTrend, generatedAt: new Date().toISOString() });
});

// GET /api/reports/my-summary — the data behind the staff "Tracker" view.
// Scoped to the signed-in person only (requireAuth is enough; no admin
// permission needed — everyone can see their own progress).
router.get("/my-summary", requireAuth, (req, res) => {
  const userId = req.user.userId;

  const tasks = db.prepare("SELECT status, created_at FROM tasks WHERE user_id = ?").all(userId);
  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status != 'done'
       AND due_date IS NOT NULL AND due_date < datetime('now')`
    )
    .get(userId).n;
  const taskCounts = {
    total: tasks.length,
    open: tasks.filter((t) => t.status !== "done").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue,
  };
  const completionRate = taskCounts.total === 0 ? null : Math.round((taskCounts.done / taskCounts.total) * 100);

  const attendanceDays = db
    .prepare(
      `SELECT DISTINCT date(recorded_at) AS d FROM attendance
       WHERE user_id = ? AND type = 'check_in' AND recorded_at >= datetime('now','-30 days')`
    )
    .all(userId).length;
  const checkedInToday = !!db
    .prepare("SELECT 1 FROM attendance WHERE user_id = ? AND type = 'check_in' AND date(recorded_at) = date('now')")
    .get(userId);

  const policies = db.prepare("SELECT id, version FROM policies").all();
  const acked = new Set(
    db
      .prepare("SELECT policy_id, policy_version FROM policy_acknowledgments WHERE user_id = ?")
      .all(userId)
      .map((a) => `${a.policy_id}:${a.policy_version}`)
  );
  const policiesPending = policies.filter((p) => !acked.has(`${p.id}:${p.version}`)).length;

  // Recent activity timeline — last 10 task status changes, for the "what have
  // I actually been doing" view.
  const timeline = db
    .prepare(
      `SELECT te.event, te.detail, te.channel, te.created_at, t.title
       FROM task_events te JOIN tasks t ON t.id = te.task_id
       WHERE t.user_id = ? ORDER BY te.id DESC LIMIT 10`
    )
    .all(userId);

  res.json({
    tasks: { ...taskCounts, completionRate },
    attendance: { daysPresentLast30: attendanceDays, checkedInToday },
    policiesPending,
    timeline,
  });
});

export default router;
