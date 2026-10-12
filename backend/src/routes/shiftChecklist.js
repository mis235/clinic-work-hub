import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(process.env.DATA_DIR || path.join(__dirname, "..", ".."), "uploads");
const UPLOAD_DIR = path.join(UPLOAD_ROOT, "shift-checklist");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname || "") || ".jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — plenty for a phone-camera check-in photo
});

const router = Router();

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function templateFor(roleName) {
  const rows = db
    .prepare(`SELECT section, item_text, sort_order FROM shift_checklist_templates WHERE role_name = ? ORDER BY sort_order`)
    .all(roleName);
  const sections = [];
  for (const r of rows) {
    let sec = sections.find((s) => s.section === r.section);
    if (!sec) { sec = { section: r.section, items: [] }; sections.push(sec); }
    sec.items.push(r.item_text);
  }
  const metrics = db
    .prepare(`SELECT field_name FROM shift_checklist_metric_fields WHERE role_name = ? ORDER BY sort_order`)
    .all(roleName)
    .map((r) => r.field_name);
  return { sections, metrics };
}

// GET /api/shift-checklist/template — the logged-in user's own role template, for today.
router.get("/template", requireAuth, (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) {
    return res.status(404).json({ error: "No shift checklist is assigned to your role yet. Ask an admin to set one up from Staff." });
  }
  const { sections, metrics } = templateFor(user.shift_role);
  if (sections.length === 0) {
    return res.status(404).json({ error: `No checklist items found for "${user.shift_role}" yet.` });
  }
  res.json({ roleName: user.shift_role, sections, metrics });
});

// GET /api/shift-checklist/today — what the logged-in user has already submitted today (both shifts), if anything.
router.get("/today", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? ORDER BY shift`)
    .all(req.user.userId, todayISO());
  res.json(rows.map(serializeSubmission));
});

function serializeSubmission(row) {
  return {
    id: row.id,
    userId: row.user_id,
    shift: row.shift,
    workDate: row.work_date,
    items: JSON.parse(row.items_json),
    metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null,
    completed: row.completed,
    total: row.total,
    completionPct: row.completion_pct,
    photoUrl: row.photo_path ? `/uploads/shift-checklist/${path.basename(row.photo_path)}` : null,
    photoLiveTimestamp: row.photo_live_timestamp,
    photoAiCheck: row.photo_ai_check,
    status: row.status || "submitted",
    updatedAt: row.updated_at || row.submitted_at,
    submittedAt: row.submitted_at,
    staffName: row.staff_name, // present only when joined in (admin list)
    roleName: row.role_name,
  };
}

async function runAiPhotoCheck(filePath, mimeType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "AI photo check unavailable — no ANTHROPIC_API_KEY configured on the server.";
  }
  try {
    const bytes = fs.readFileSync(filePath);
    const base64 = bytes.toString("base64");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: base64 } },
            { type: "text", text: "This is a staff check-in photo submitted as evidence of completed clinic work (e.g. a cleaned room, stocked shelf, or completed task). In one short sentence, say whether the photo looks genuine and usable (clear, well-lit, not a screenshot or an obviously unrelated image) or flag a problem with it." },
          ],
        }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return `(AI photo check returned no result: ${JSON.stringify(data?.error || data)})`;
    }
    return data.content?.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() || "(AI photo check returned an empty result.)";
  } catch (err) {
    return `(AI photo check failed: ${err.message})`;
  }
}

// POST /api/shift-checklist/progress — autosave while the checklist is being filled in.
// JSON { shift, items:[{section,text,done}], metrics }. Creates the day's row as 'in_progress'
// (so managers see live progress); never downgrades an already-submitted row's status.
router.post("/progress", requireAuth, requirePermission("shiftchecklist:submit"), (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) return res.status(400).json({ error: "No shift checklist is assigned to your role." });
  const { shift, items, metrics } = req.body || {};
  if (!shift || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "shift and items are required" });
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((completed / total) * 100);
  db.prepare(`
    INSERT INTO shift_checklist_submissions
      (id, user_id, role_name, shift, work_date, items_json, metrics_json, completed, total, completion_pct, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', datetime('now'))
    ON CONFLICT(user_id, work_date, shift) DO UPDATE SET
      items_json = excluded.items_json, metrics_json = excluded.metrics_json,
      completed = excluded.completed, total = excluded.total, completion_pct = excluded.completion_pct,
      updated_at = datetime('now')
  `).run(randomUUID(), req.user.userId, user.shift_role, shift, todayISO(), JSON.stringify(items), metrics ? JSON.stringify(metrics) : null, completed, total, pct);
  const row = db.prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? AND shift = ?`).get(req.user.userId, todayISO(), shift);
  res.json(serializeSubmission(row));
});

// POST /api/shift-checklist/submit
// multipart/form-data: shift, items (JSON string [{section,text,done}]), metrics (JSON string, optional),
// photoLiveTimestamp (string, captured client-side when the photo was taken), photo (file, optional).
router.post("/submit", requireAuth, requirePermission("shiftchecklist:submit"), upload.single("photo"), async (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) return res.status(400).json({ error: "No shift checklist is assigned to your role." });

  const { shift, photoLiveTimestamp } = req.body;
  if (!shift) return res.status(400).json({ error: "shift is required" });

  let items, metrics;
  try {
    items = JSON.parse(req.body.items || "[]");
    metrics = req.body.metrics ? JSON.parse(req.body.metrics) : null;
  } catch {
    return res.status(400).json({ error: "items/metrics must be valid JSON" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array is required" });
  }

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const completionPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  let photoAiCheck = null;
  if (req.file) {
    photoAiCheck = await runAiPhotoCheck(req.file.path, req.file.mimetype);
  }

  const id = randomUUID();
  const workDate = todayISO();
  db.prepare(`
    INSERT INTO shift_checklist_submissions
      (id, user_id, role_name, shift, work_date, items_json, metrics_json, completed, total, completion_pct, photo_path, photo_live_timestamp, photo_ai_check, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'))
    ON CONFLICT(user_id, work_date, shift) DO UPDATE SET
      items_json = excluded.items_json, metrics_json = excluded.metrics_json,
      completed = excluded.completed, total = excluded.total, completion_pct = excluded.completion_pct,
      photo_path = COALESCE(excluded.photo_path, shift_checklist_submissions.photo_path),
      photo_live_timestamp = COALESCE(excluded.photo_live_timestamp, shift_checklist_submissions.photo_live_timestamp),
      photo_ai_check = COALESCE(excluded.photo_ai_check, shift_checklist_submissions.photo_ai_check),
      status = 'submitted', updated_at = datetime('now'), submitted_at = datetime('now')
  `).run(
    id, req.user.userId, user.shift_role, shift, workDate,
    JSON.stringify(items), metrics ? JSON.stringify(metrics) : null,
    completed, total, completionPct,
    req.file ? req.file.path : null, photoLiveTimestamp || null, photoAiCheck
  );

  const row = db.prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? AND shift = ?`)
    .get(req.user.userId, workDate, shift);
  res.json(serializeSubmission(row));
});

// GET /api/shift-checklist/submissions — admin/manager view across staff.
// query: date (YYYY-MM-DD, default today), shift, roleName
router.get("/submissions", requireAuth, requirePermission("shiftchecklist:view_all"), (req, res) => {
  const date = req.query.date || todayISO();
  const clauses = ["s.work_date = ?"];
  const params = [date];
  if (req.query.shift) { clauses.push("s.shift = ?"); params.push(req.query.shift); }
  if (req.query.roleName) { clauses.push("s.role_name = ?"); params.push(req.query.roleName); }

  const rows = db.prepare(`
    SELECT s.*, u.name AS staff_name, u.department_id
    FROM shift_checklist_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY CASE s.status WHEN 'in_progress' THEN 0 ELSE 1 END, s.role_name
  `).all(...params);

  // Also report who HASN'T submitted yet today, so admins see gaps, not just what came in.
  const expected = db.prepare(`SELECT id, name, shift_role FROM users WHERE shift_role IS NOT NULL AND active = 1`).all();
  const startedUserIds = new Set(rows.map((r) => r.user_id));
  const missing = expected.filter((u) => !startedUserIds.has(u.id)).map((u) => ({ userId: u.id, name: u.name, roleName: u.shift_role }));

  res.json({ date, submissions: rows.map(serializeSubmission), missing });
});

export default router;
