// In-app notes to staff (see engage.js). Everyone reads their own; HR and admin see what was sent.
import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { waLinkFor, enabled } from "../engage.js";

const router = Router();
const canSeeAll = (req) => req.user.roleName === "admin" || accessFor(req.user.userId, req.user.roleName).isHr;

router.get("/mine", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, kind, title, body, msg_date AS date FROM staff_messages WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 3").all(req.user.userId));
});
router.post("/:id/read", requireAuth, (req, res) => {
  db.prepare("UPDATE staff_messages SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(req.params.id, req.user.userId);
  res.json({ ok: true });
});
router.get("/", requireAuth, (req, res) => {
  if (!canSeeAll(req)) return res.status(403).json({ error: "Only HR or admin can see this" });
  const rows = db.prepare("SELECT m.id, m.kind, m.title, m.body, m.msg_date AS date, m.email_status AS emailStatus, m.read_at AS readAt, u.id AS userId, u.name FROM staff_messages m JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC LIMIT 40").all();
  res.json({ enabled: enabled(), messages: rows.map((r) => ({ ...r, whatsappUrl: waLinkFor(r.userId, r.body) })) });
});
router.put("/settings", requireAuth, (req, res) => {
  if (!canSeeAll(req)) return res.status(403).json({ error: "Only HR or admin can do this" });
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('engage_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(req.body?.enabled ? "1" : "0");
  res.json({ ok: true });
});
export default router;
