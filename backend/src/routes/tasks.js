import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { sendTaskMessage } from "../whatsapp.js";

const router = Router();

function logEvent(taskId, event, detail = null, channel = "web") {
  db.prepare(
    "INSERT INTO task_events (task_id, event, detail, channel) VALUES (?, ?, ?, ?)"
  ).run(taskId, event, detail, channel);
}

function withEvents(task) {
  const events = db
    .prepare("SELECT event, detail, channel, created_at FROM task_events WHERE task_id = ? ORDER BY id")
    .all(task.id);
  return { ...task, events };
}

// GET /api/tasks — task:view_all sees everything; otherwise only your own (task:view_own).
router.get("/", requireAuth, (req, res) => {
  let rows;
  const granted = db
    .prepare(
      `SELECT p.action FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
    )
    .all(req.user.roleId)
    .map((r) => r.action);

  if (granted.includes("task:view_all")) {
    rows = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();
  } else if (granted.includes("task:view_own")) {
    rows = db.prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC").all(req.user.userId);
  } else {
    return res.status(403).json({ error: "Missing permission: task:view_own or task:view_all" });
  }
  res.json(rows.map(withEvents));
});

// POST /api/tasks — requires task:assign
router.post("/", requireAuth, requirePermission("task:assign"), async (req, res) => {
  const { userId, title, category, notes, dueDate, sendNow } = req.body || {};
  if (!userId || !title) return res.status(400).json({ error: "userId and title are required" });

  const assignee = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!assignee) return res.status(404).json({ error: "User not found" });

  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, user_id, title, category, notes, due_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, userId, title, category || "General", notes || null, dueDate || null, req.user.userId);
  logEvent(id, "created", `Assigned to ${assignee.name}`);

  let task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

  if (sendNow) {
    try {
      await sendAndMark(task, assignee);
      task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    } catch (err) {
      logEvent(id, "send_failed", err.message);
    }
  }

  res.status(201).json(withEvents(task));
});

// POST /api/tasks/:id/send — requires task:assign
router.post("/:id/send", requireAuth, requirePermission("task:assign"), async (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const assignee = db.prepare("SELECT * FROM users WHERE id = ?").get(task.user_id);

  try {
    await sendAndMark(task, assignee);
    res.json(withEvents(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id)));
  } catch (err) {
    res.status(502).json({ error: `WhatsApp send failed: ${err.message}` });
  }
});

async function sendAndMark(task, assignee) {
  const dueLabel = task.due_date ? new Date(task.due_date).toLocaleString() : null;
  const result = await sendTaskMessage({
    toPhone: assignee.phone,
    staffName: assignee.name,
    title: task.title,
    category: task.category,
    dueDateLabel: dueLabel,
  });
  const messageId = result?.messages?.[0]?.id || null;
  db.prepare(
    "UPDATE tasks SET status = 'sent', whatsapp_message_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(messageId, task.id);
  logEvent(task.id, "sent_whatsapp", messageId, "whatsapp");
}

// PATCH /api/tasks/:id/status — the assignee updates their own task (task:update_own),
// OR someone with task:assign (admin/manager) overrides it from the dashboard.
// This single endpoint is what web, PWA, and the WhatsApp webhook all ultimately call —
// one code path, one source of truth, regardless of channel.
router.patch("/:id/status", requireAuth, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const granted = db
    .prepare(
      `SELECT p.action FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
    )
    .all(req.user.roleId)
    .map((r) => r.action);

  const isOwner = task.user_id === req.user.userId;
  const canOverride = granted.includes("task:assign");
  if (!isOwner && !canOverride) return res.status(403).json({ error: "Not authorized to update this task" });

  const { status, channel } = req.body || {};
  const valid = ["pending", "sent", "accepted", "in_progress", "done", "extension_requested", "issue_reported"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, task.id);
  logEvent(task.id, "status_changed", `Set to ${status}`, channel || "web");
  res.json(withEvents(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id)));
});

export default router;
