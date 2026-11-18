// Help desk: staff raise a question or problem, admin and HR reply and mark it solved. Replies show on the bell.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { notifyUser } from "../engage.js";

const router = Router();
export const CATEGORIES = ["App problem", "Login or PIN", "Attendance", "Payslip or salary", "Leave", "Tasks or checklist", "Other"];
const STATUSES = ["open", "in_progress", "resolved"];

db.exec(`CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, category TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS ticket_replies (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);

const isHelper = (u) => u.roleName === "admin" || accessFor(u.userId, u.roleName).isHr;
const helpers = () => db.prepare("SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1").all().filter((u) => u.role === "admin" || accessFor(u.id, u.role).isHr).map((u) => u.id);
const clean = (v, n) => String(v || "").trim().slice(0, n);
const row = (t) => t && ({ ...t, replies: db.prepare("SELECT COUNT(*) n FROM ticket_replies WHERE ticket_id = ?").get(t.id).n });

router.get("/categories", requireAuth, (req, res) => res.json(CATEGORIES));

router.get("/tickets", requireAuth, (req, res) => {
  const all = isHelper(req.user), st = STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT t.*, u.name AS user_name, d.name AS department FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE ${all ? "1=1" : "t.user_id = ?"} ${st ? "AND t.status = ?" : ""} ORDER BY (t.status = 'resolved'), t.updated_at DESC LIMIT 200`).all(...[...(all ? [] : [req.user.userId]), ...(st ? [st] : [])]);
  res.json({ canManage: all, rows: rows.map(row) });
});

router.post("/tickets", requireAuth, (req, res) => {
  const subject = clean(req.body?.subject, 120), body = clean(req.body?.body, 2000);
  if (!subject) return res.status(400).json({ error: "Write a short title for your problem" });
  if (!body) return res.status(400).json({ error: "Tell us what happened" });
  const category = CATEGORIES.includes(req.body?.category) ? req.body.category : "Other", priority = req.body?.priority === "urgent" ? "urgent" : "normal";
  const id = randomUUID();
  db.prepare("INSERT INTO tickets (id, user_id, subject, category, priority) VALUES (?,?,?,?,?)").run(id, req.user.userId, subject, category, priority);
  db.prepare("INSERT INTO ticket_replies (id, ticket_id, user_id, body) VALUES (?,?,?,?)").run(randomUUID(), id, req.user.userId, body);
  const me = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId)?.name || "Someone";
  for (const h of helpers()) if (h !== req.user.userId) notifyUser(h, `help:${id}`, `Help desk: ${subject}`, `${me} asked: ${body}`);
  res.status(201).json({ id });
});

function load(req, res) {
  const t = db.prepare("SELECT t.*, u.name AS user_name FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?").get(req.params.id);
  if (!t) { res.status(404).json({ error: "Not found" }); return null; }
  if (t.user_id !== req.user.userId && !isHelper(req.user)) { res.status(403).json({ error: "Not allowed" }); return null; }
  return t;
}

router.get("/tickets/:id", requireAuth, (req, res) => {
  const t = load(req, res); if (!t) return;
  const replies = db.prepare("SELECT r.id, r.body, r.created_at AS createdAt, r.user_id AS userId, u.name, (r.user_id = ?) AS mine, (r.user_id != ?) AS fromOther FROM ticket_replies r JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ? ORDER BY r.created_at, r.rowid").all(t.user_id, t.user_id, req.params.id)
    .map((r) => ({ ...r, fromStaff: !!r.mine, mine: r.userId === req.user.userId }));
  res.json({ ticket: t, replies, canManage: isHelper(req.user) });
});

router.post("/tickets/:id/replies", requireAuth, (req, res) => {
  const t = load(req, res); if (!t) return;
  const body = clean(req.body?.body, 2000); if (!body) return res.status(400).json({ error: "Write your reply" });
  db.prepare("INSERT INTO ticket_replies (id, ticket_id, user_id, body) VALUES (?,?,?,?)").run(randomUUID(), t.id, req.user.userId, body);
  const staffWrote = req.user.userId === t.user_id;
  db.prepare("UPDATE tickets SET updated_at = datetime('now'), status = CASE WHEN ? AND status = 'resolved' THEN 'open' WHEN NOT ? AND status = 'open' THEN 'in_progress' ELSE status END WHERE id = ?").run(staffWrote ? 1 : 0, staffWrote ? 1 : 0, t.id);
  const me = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId)?.name || "Someone";
  if (staffWrote) { for (const h of helpers()) if (h !== req.user.userId) notifyUser(h, `help:${t.id}`, `Help desk: ${t.subject}`, `${me} replied: ${body}`); }
  else notifyUser(t.user_id, `help:${t.id}`, `Reply to: ${t.subject}`, `${me}: ${body}`);
  res.status(201).json({ ok: true });
});

router.put("/tickets/:id/status", requireAuth, (req, res) => {
  const t = load(req, res); if (!t) return;
  const st = req.body?.status; if (!STATUSES.includes(st)) return res.status(400).json({ error: "Unknown status" });
  if (!isHelper(req.user) && !(t.user_id === req.user.userId && st === "resolved")) return res.status(403).json({ error: "Only admin or HR can change this" });
  db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(st, t.id);
  if (st === "resolved" && t.user_id !== req.user.userId) notifyUser(t.user_id, `help:${t.id}`, `Solved: ${t.subject}`, "Your help desk request was marked as solved. Open it again if it still happens.");
  res.json({ ok: true });
});

export default router;
