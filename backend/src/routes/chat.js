// Direct messages between any two people (staff to staff, staff to admin). New messages show on the receiver's bell.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { notifyUser } from "../engage.js";

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL, read_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
db.exec("CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(from_id, to_id, created_at)");

// Everyone you can message, with the last message and how many you have not read.
router.get("/people", requireAuth, (req, res) => {
  const me = req.user.userId;
  const rows = db.prepare(`SELECT u.id, u.name, u.designation, d.name AS department, r.name AS role, (u.photo_path IS NOT NULL) AS hasPhoto,
      (SELECT COUNT(*) FROM direct_messages m WHERE m.from_id = u.id AND m.to_id = ? AND m.read_at IS NULL) AS unread,
      (SELECT MAX(created_at) FROM direct_messages m WHERE (m.from_id = u.id AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = u.id)) AS lastAt,
      (SELECT body FROM direct_messages m WHERE (m.from_id = u.id AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = u.id) ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS lastBody
    FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 AND u.id != ? ORDER BY (lastAt IS NULL), lastAt DESC, u.name`).all(me, me, me, me, me, me);
  res.json(rows.map((r) => ({ ...r, hasPhoto: !!r.hasPhoto, isAdmin: r.role === "admin" })));
});

router.get("/with/:id", requireAuth, (req, res) => {
  const me = req.user.userId, other = req.params.id;
  const u = db.prepare("SELECT id, name, designation FROM users WHERE id = ? AND active = 1").get(other);
  if (!u) return res.status(404).json({ error: "Person not found" });
  db.prepare("UPDATE direct_messages SET read_at = datetime('now') WHERE from_id = ? AND to_id = ? AND read_at IS NULL").run(other, me);
  db.prepare("UPDATE staff_messages SET read_at = datetime('now') WHERE user_id = ? AND kind = ? AND read_at IS NULL").run(me, `dm:${other}`);
  const rows = db.prepare("SELECT id, from_id AS fromId, body, created_at AS createdAt FROM direct_messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC, rowid DESC LIMIT 100").all(me, other, other, me).reverse();
  res.json({ person: u, messages: rows.map((m) => ({ ...m, mine: m.fromId === me })) });
});

router.post("/with/:id", requireAuth, (req, res) => {
  const me = req.user.userId, other = req.params.id, body = String(req.body?.body || "").trim().slice(0, 1500);
  if (other === me) return res.status(400).json({ error: "Choose someone else" });
  if (!body) return res.status(400).json({ error: "Write a message" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(other)) return res.status(404).json({ error: "Person not found" });
  db.prepare("INSERT INTO direct_messages (id, from_id, to_id, body) VALUES (?,?,?,?)").run(randomUUID(), me, other, body);
  const name = db.prepare("SELECT name FROM users WHERE id = ?").get(me)?.name || "Someone";
  notifyUser(other, `dm:${me}`, `Message from ${name}`, body);
  res.status(201).json({ ok: true });
});

export default router;
