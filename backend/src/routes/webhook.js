import { Router } from "express";
import db from "../db.js";
import { parseInboundMessage, sendTextMessage } from "../whatsapp.js";

const router = Router();

// GET /webhook/whatsapp — one-time verification call from Meta.
router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Keyword -> status, matching the fuller task lifecycle in the spec
// (accept, start, done, request extension, report an issue).
const KEYWORD_MAP = {
  "1": "accepted", accept: "accepted", accepted: "accepted",
  "2": "in_progress", start: "in_progress", started: "in_progress",
  "3": "done", done: "done", complete: "done", completed: "done", finished: "done",
  "4": "extension_requested", extension: "extension_requested",
  "5": "issue_reported", issue: "issue_reported", problem: "issue_reported",
};

// POST /webhook/whatsapp — this is the single inbound gateway for every staff
// reply. It never talks to the frontend directly; it only ever writes to the
// same `tasks` table the web/PWA app reads, which is what keeps every device
// in sync without duplicate logic per platform.
router.post("/whatsapp", async (req, res) => {
  res.sendStatus(200); // ack fast; Meta retries aggressively otherwise

  const parsed = parseInboundMessage(req.body);
  if (!parsed) return;
  const { fromPhone, text } = parsed;

  db.prepare("INSERT INTO whatsapp_inbound_log (from_phone, raw_payload) VALUES (?, ?)").run(
    fromPhone,
    JSON.stringify(req.body)
  );

  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND active = 1").get(fromPhone);
  if (!user) return; // message from a number not in the directory

  const task = db
    .prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND status NOT IN ('done')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(user.id);
  if (!task) return;

  const newStatus = KEYWORD_MAP[text.trim().toLowerCase()];
  if (!newStatus) return; // unrecognized reply — leave status untouched

  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, task.id);
  db.prepare(
    "INSERT INTO task_events (task_id, event, detail, channel) VALUES (?, 'reply_received', ?, 'whatsapp')"
  ).run(task.id, `"${text}" → ${newStatus}`);
  db.prepare("UPDATE whatsapp_inbound_log SET matched_task_id = ? WHERE id = last_insert_rowid()").run(task.id);

  try {
    const labels = {
      accepted: `👍 "${task.title}" marked accepted.`,
      in_progress: `🚧 "${task.title}" marked in progress.`,
      done: `✅ "${task.title}" marked done. Thank you!`,
      extension_requested: `🕒 Extension request logged for "${task.title}". Admin will follow up.`,
      issue_reported: `⚠️ Issue logged for "${task.title}". Admin has been notified.`,
    };
    await sendTextMessage({ toPhone: fromPhone, text: labels[newStatus] });
  } catch {
    // status is already saved even if the confirmation message fails to send
  }
});

export default router;
