// Automatic custom messages to staff. HR/admin write the message once and pick when it goes out
// (every day, certain weekdays, a date, birthdays, work anniversaries, festival/event days).
// Each message shows as a banner in the app, goes by email when set up, and by WhatsApp through TeleCRM when connected.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { sendEmail, isEmailConfigured } from "../email.js";
import { sendViaTelecrm } from "../telecrm.js";

db.exec(`CREATE TABLE IF NOT EXISTS auto_messages (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, trigger_type TEXT NOT NULL, send_time TEXT NOT NULL DEFAULT '09:00',
  weekdays TEXT, once_date TEXT, audience TEXT NOT NULL DEFAULT 'all', whatsapp INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, last_run TEXT, created_at TEXT DEFAULT (datetime('now'))
)`);

export const TRIGGERS = ["daily", "weekly", "once", "birthday", "birthday_team", "anniversary", "event"];
const router = Router();
const canManage = (req) => req.user.roleName === "admin" || accessFor(req.user.userId, req.user.roleName).isHr;
const guard = (req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: "Only HR or admin can do this" }));

const ser = (m) => ({ id: m.id, title: m.title, body: m.body, trigger: m.trigger_type, time: m.send_time, weekdays: m.weekdays ? m.weekdays.split(",").map(Number) : [], date: m.once_date || "",
  audience: m.audience, whatsapp: !!m.whatsapp, active: !!m.active, lastRun: m.last_run || "" });

function clean(b) {
  const title = String(b?.title || "").trim().slice(0, 120), body = String(b?.body || "").trim().slice(0, 1200);
  const trigger = TRIGGERS.includes(b?.trigger) ? b.trigger : "daily";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(b?.time || "") ? b.time : "09:00";
  const weekdays = trigger === "weekly" ? [...new Set((b?.weekdays || []).map(Number).filter((n) => n >= 0 && n <= 6))].join(",") : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b?.date || "") ? b.date : "";
  if (!title || !body) return { error: "Write a title and a message" };
  if (trigger === "weekly" && !weekdays) return { error: "Choose at least one day of the week" };
  if (trigger === "once" && !date) return { error: "Choose the date" };
  const audience = b?.audience && b.audience !== "all" && db.prepare("SELECT 1 FROM departments WHERE id = ?").get(b.audience) ? b.audience : "all";
  return { title, body, trigger, time, weekdays, date, audience, whatsapp: b?.whatsapp === false ? 0 : 1, active: b?.active === false ? 0 : 1 };
}

router.get("/", requireAuth, guard, (req, res) => {
  res.json({ messages: db.prepare("SELECT * FROM auto_messages ORDER BY created_at DESC").all().map(ser),
    departments: db.prepare("SELECT id, name FROM departments ORDER BY name").all() });
});
router.post("/", requireAuth, guard, (req, res) => {
  const c = clean(req.body); if (c.error) return res.status(400).json({ error: c.error });
  const id = randomUUID();
  db.prepare("INSERT INTO auto_messages (id, title, body, trigger_type, send_time, weekdays, once_date, audience, whatsapp, active) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, c.title, c.body, c.trigger, c.time, c.weekdays, c.date, c.audience, c.whatsapp, c.active);
  res.status(201).json({ id });
});
router.put("/:id", requireAuth, guard, (req, res) => {
  const c = clean(req.body); if (c.error) return res.status(400).json({ error: c.error });
  const r = db.prepare("UPDATE auto_messages SET title=?, body=?, trigger_type=?, send_time=?, weekdays=?, once_date=?, audience=?, whatsapp=?, active=?, last_run=NULL WHERE id=?")
    .run(c.title, c.body, c.trigger, c.time, c.weekdays, c.date, c.audience, c.whatsapp, c.active, req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});
router.delete("/:id", requireAuth, guard, (req, res) => {
  db.prepare("DELETE FROM auto_messages WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
// Sends it only to the person pressing the button, so HR can see how it reads before it goes to everyone.
router.post("/:id/test", requireAuth, guard, (req, res) => {
  const m = db.prepare("SELECT * FROM auto_messages WHERE id = ?").get(req.params.id); if (!m) return res.status(404).json({ error: "Not found" });
  const u = db.prepare("SELECT id, name, email, phone FROM users WHERE id = ?").get(req.user.userId);
  const sent = deliver(u, m, { kind: "autotest:" + randomUUID().slice(0, 6), date: ist().date, vars: { event: "Festival", years: "2" } });
  res.json({ ok: true, whatsapp: sent });
});
export default router;

// Ready on day one: a wish for the birthday person and a "wish them" note for the rest of the team.
(() => {
  try {
    db.prepare("UPDATE auto_messages SET body = ? WHERE trigger_type = 'birthday_team' AND body = ?").run("Hi {name}, today is {person}'s birthday. Please wish {person} a very happy birthday when you meet!", "Hi {name}, today is {person}'s birthday. Please wish them when you meet. A kind word makes their day!");
    const done = db.prepare("SELECT value FROM app_settings WHERE key = 'auto_msgs_seeded'").get();
    if (done) return;
    const add = (title, body, trigger) => db.prepare("INSERT INTO auto_messages (id, title, body, trigger_type, send_time, audience, whatsapp, active) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), title, body, trigger, "09:00", "all", 1, 1);
    if (db.prepare("SELECT COUNT(*) n FROM auto_messages").get().n === 0) {
      add("Happy Birthday, {name}!", "Dear {name}, wishing you a very happy birthday from all of us at Dr. Nishita's Clinic. Thank you for being part of our family. Have a wonderful day!", "birthday");
      add("Today is {person}'s birthday", "Hi {name}, today is {person}'s birthday. Please wish {person} a very happy birthday when you meet!", "birthday_team");
    }
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_msgs_seeded', '1')").run();
  } catch (e) { console.error("auto message defaults:", e.message); }
})();

const ist = () => { const d = new Date(Date.now() + 19800000); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16), dow: d.getUTCDay(), md: d.toISOString().slice(5, 10) }; };
const fill = (t, u, vars) => String(t).replace(/\{name\}/gi, String(u.name || "").trim().split(/\s+/)[0] || "there").replace(/\{event\}/gi, vars.event || "").replace(/\{years\}/gi, vars.years || "").replace(/\{person\}/gi, vars.person || "");

function deliver(u, m, { kind, date, vars = {} }) {
  const title = fill(m.title, u, vars), body = fill(m.body, u, vars);
  const r = db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body, email_status) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), u.id, kind, date, title, body, u.email ? (isEmailConfigured() ? "sending" : "email not set up") : "no email address");
  if (!r.changes) return false;
  if (u.email && isEmailConfigured()) sendEmail({ to: u.email, subject: title, html: `<p>${body.replace(/\n/g, "<br>")}</p><p style="color:#666">Dr. Nishita's Clinic</p>` }).catch(() => {});
  return m.whatsapp ? sendViaTelecrm({ name: u.name, phone: u.phone, message: `${title}: ${body}`, event: "auto_message" }) : false;
}

/** Called every minute. Sends what is due now (or earlier today, if the server was off). Each person gets each message once per day. */
export function runAutoMessages() {
  const t = ist();
  const people = db.prepare("SELECT id, name, email, phone, department_id, birthday, joined_at FROM users WHERE active = 1").all();
  for (const m of db.prepare("SELECT * FROM auto_messages WHERE active = 1").all()) {
    if (m.send_time > t.hhmm || m.last_run === t.date) continue;
    let targets = [], vars = {};
    if (m.trigger_type === "daily") targets = people;
    else if (m.trigger_type === "weekly") { if (!(m.weekdays || "").split(",").includes(String(t.dow))) continue; targets = people; }
    else if (m.trigger_type === "once") { if (m.once_date !== t.date) continue; targets = people; }
    else if (m.trigger_type === "birthday_team") {
      // Someone has a birthday today: everyone else is told so they can wish them.
      const celebrants = people.filter((u) => u.birthday && String(new Date(u.birthday).toISOString()).slice(5, 10) === t.md);
      for (const c of celebrants) for (const u of people) {
        if (u.id === c.id || (m.audience !== "all" && u.department_id !== m.audience)) continue;
        try { deliver(u, m, { kind: `auto:${m.id}:${c.id}`, date: t.date, vars: { person: c.name } }); } catch (e) { console.error("auto message:", e.message); }
      }
      db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id); continue;
    }
    else if (m.trigger_type === "birthday") targets = people.filter((u) => u.birthday && String(new Date(u.birthday).toISOString()).slice(5, 10) === t.md);
    else if (m.trigger_type === "anniversary") targets = people.filter((u) => { if (!u.joined_at) return false; const d = new Date(u.joined_at); return !Number.isNaN(d.getTime()) && d.toISOString().slice(5, 10) === t.md && Number(t.date.slice(0, 4)) - d.getUTCFullYear() >= 1; });
    else if (m.trigger_type === "event") {
      const ev = db.prepare("SELECT title FROM clinic_events WHERE event_date = ? OR event_date = ?").get(t.date, t.md); if (!ev) { db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id); continue; }
      vars = { event: ev.title }; targets = people;
    }
    if (m.audience !== "all") targets = targets.filter((u) => u.department_id === m.audience);
    try {
      for (const u of targets) {
        const years = m.trigger_type === "anniversary" ? String(Number(t.date.slice(0, 4)) - new Date(u.joined_at).getUTCFullYear()) : "";
        deliver(u, m, { kind: "auto:" + m.id, date: t.date, vars: { ...vars, years } });
      }
    } catch (e) { console.error("auto message:", e.message); }
    db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id);
  }
}
