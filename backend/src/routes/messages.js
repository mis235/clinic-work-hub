// In-app notes to staff (see engage.js). Everyone reads their own; HR and admin see what was sent.
import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { randomUUID } from "node:crypto";
import { waLinkFor, enabled } from "../engage.js";
import { sendEmail, isEmailConfigured } from "../email.js";

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

const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const staffRows = () => db.prepare("SELECT id, name, email, phone, alt_phone, designation FROM users WHERE active = 1 ORDER BY name").all();
const waUrl = (phone, text) => { let d = String(phone || "").replace(/\D/g, ""); if (!d) return null; if (d.length === 10) d = "91" + d; return `https://wa.me/${d}?text=${encodeURIComponent(text)}`; };

// An announcement to everyone: shown as a banner in the app, emailed, and WhatsApp links are returned for HR to send (or to paste into TeleCRM).
router.post("/announce", requireAuth, (req, res) => {
  if (!canSeeAll(req)) return res.status(403).json({ error: "Only HR or admin can send announcements" });
  const title = String(req.body?.title || "").trim().slice(0, 120), body = String(req.body?.body || "").trim().slice(0, 1500);
  if (!title || !body) return res.status(400).json({ error: "Write a title and a message" });
  const kind = "announce:" + randomUUID().slice(0, 8), people = staffRows();
  const ins = db.prepare("INSERT INTO staff_messages (id, user_id, kind, msg_date, title, body, email_status) VALUES (?,?,?,?,?,?,?)");
  let emailed = 0;
  for (const u of people) {
    const id = randomUUID(); let st = u.email ? (isEmailConfigured() ? "sending" : "email not set up") : "no email address";
    ins.run(id, u.id, kind, today(), title, body, st);
    if (st === "sending") sendEmail({ to: u.email, subject: title, html: `<p>${body.replace(/\n/g, "<br>")}</p><p style="color:#666">Dr. Nishita's Clinic</p>` })
      .then(() => db.prepare("UPDATE staff_messages SET email_status = 'sent' WHERE id = ?").run(id)).catch((e) => db.prepare("UPDATE staff_messages SET email_status = ? WHERE id = ?").run("failed", id));
    if (u.email && isEmailConfigured()) emailed++;
  }
  const text = `${title}\n\n${body}\n\n— Dr. Nishita's Clinic`;
  res.status(201).json({ sent: people.length, emailed, text, recipients: people.map((u) => ({ name: u.name, whatsappUrl: waUrl(u.phone, text), whatsappUrl2: waUrl(u.alt_phone, text) })) });
});

// Names and numbers (clinic and personal) for importing into TeleCRM as a "Staff" list.
router.get("/contacts", requireAuth, (req, res) => {
  if (!canSeeAll(req)) return res.status(403).json({ error: "Only HR or admin can do this" });
  res.json(staffRows().map((u) => ({ name: u.name, designation: u.designation || "", phone: u.phone || "", altPhone: u.alt_phone || "", email: u.email || "" })));
});
export default router;
