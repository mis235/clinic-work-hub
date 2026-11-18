// Automatic custom messages to staff. HR/admin write the message once and pick when it goes out
// (every day, certain weekdays, a date, birthdays, work anniversaries, festival/event days).
// Each message shows as a banner in the app, goes by email when set up, and by WhatsApp through TeleCRM when connected.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { birthdayMD } from "./leave.js";
import { shiftOn } from "./roster.js";
import { greetingFor, quoteFor } from "../quotes.js";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { sendEmail, isEmailConfigured } from "../email.js";
import { sendViaTelecrm, telecrmUrl } from "../telecrm.js";

db.exec(`CREATE TABLE IF NOT EXISTS auto_messages (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, trigger_type TEXT NOT NULL, send_time TEXT NOT NULL DEFAULT '09:00',
  weekdays TEXT, once_date TEXT, audience TEXT NOT NULL DEFAULT 'all', whatsapp INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, last_run TEXT, created_at TEXT DEFAULT (datetime('now'))
)`);

try { db.exec("ALTER TABLE staff_messages ADD COLUMN wa_status TEXT"); } catch {}
export const TRIGGERS = ["daily", "weekly", "once", "birthday", "birthday_team", "anniversary", "event", "checklist_pending", "attendance_missing", "task_pending"];
const REMINDERS = ["checklist_pending", "attendance_missing", "task_pending"];
const router = Router();
const canManage = (req) => req.user.roleName === "admin" || accessFor(req.user.userId, req.user.roleName).isHr;
const guard = (req, res, next) => (canManage(req) ? next() : res.status(403).json({ error: "Only HR or admin can do this" }));

const ser = (m) => ({ id: m.id, title: m.title, body: m.body, trigger: m.trigger_type, time: m.send_time, weekdays: m.weekdays ? m.weekdays.split(",").map(Number) : [], date: m.once_date || "",
  audience: m.audience.startsWith("users:") ? "users" : m.audience, audienceUsers: m.audience.startsWith("users:") ? m.audience.slice(6).split(",") : [], whatsapp: !!m.whatsapp, active: !!m.active, lastRun: m.last_run || "" });

function clean(b) {
  const title = String(b?.title || "").trim().slice(0, 120), body = String(b?.body || "").trim().slice(0, 1200);
  const trigger = TRIGGERS.includes(b?.trigger) ? b.trigger : "daily";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(b?.time || "") ? b.time : "09:00";
  const weekdays = (trigger === "weekly" || REMINDERS.includes(trigger)) ? [...new Set((b?.weekdays || []).map(Number).filter((n) => n >= 0 && n <= 6))].join(",") : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b?.date || "") ? b.date : "";
  if (!title || !body) return { error: "Write a title and a message" };
  if (trigger === "weekly" && !weekdays) return { error: "Choose at least one day of the week" };
  if (trigger === "once" && !date) return { error: "Choose the date" };
  let audience = "all";
  if (b?.audience === "users" || String(b?.audience || "").startsWith("users:")) {
    const ids = [...new Set((Array.isArray(b.audienceUsers) ? b.audienceUsers : String(b.audience).slice(6).split(",")).map(String).filter(Boolean))].filter((id) => db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(id));
    if (!ids.length) return { error: "Choose at least one person" };
    audience = "users:" + ids.join(",");
  } else if (b?.audience && b.audience !== "all" && db.prepare("SELECT 1 FROM departments WHERE id = ?").get(b.audience)) audience = b.audience;
  return { title, body, trigger, time, weekdays, date, audience, whatsapp: b?.whatsapp === false ? 0 : 1, active: b?.active === false ? 0 : 1 };
}

router.get("/", requireAuth, guard, (req, res) => {
  res.json({ messages: db.prepare("SELECT * FROM auto_messages ORDER BY created_at DESC").all().map(ser),
    departments: db.prepare("SELECT id, name FROM departments ORDER BY name").all(),
    staff: db.prepare("SELECT id, name FROM users WHERE active = 1 ORDER BY name").all(),
    channels: { app: true, email: isEmailConfigured(), whatsapp: !!telecrmUrl() } });
});
// The TeleCRM link that lets WhatsApp messages go out (admin only).
router.put("/whatsapp-link", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only the admin can connect WhatsApp" });
  const url = String(req.body?.url || "").trim();
  if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: "The link must start with https://" });
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telecrm_webhook', ?)").run(url);
  res.json({ ok: true, connected: !!url });
});
const inAudience = (m, u) => m.audience === "all" || (m.audience.startsWith("users:") ? m.audience.slice(6).split(",").includes(u.id) : u.department_id === m.audience);
// Who got this message, who has read it, and why WhatsApp / email did or did not go.
router.get("/:id/log", requireAuth, guard, (req, res) => {
  const m = db.prepare("SELECT * FROM auto_messages WHERE id = ?").get(req.params.id); if (!m) return res.status(404).json({ error: "Not found" });
  const people = db.prepare("SELECT id, name, department_id FROM users WHERE active = 1 ORDER BY name").all().filter((u) => inAudience(m, u));
  const rows = db.prepare("SELECT user_id, msg_date, read_at, email_status, wa_status, created_at FROM staff_messages WHERE kind LIKE ? ORDER BY created_at DESC LIMIT 500").all(`auto:${m.id}%`);
  const last = new Map(); for (const r of rows) if (!last.has(r.user_id)) last.set(r.user_id, r);
  res.json({ title: m.title, lastRun: m.last_run || "", people: people.map((u) => { const r = last.get(u.id); return { id: u.id, name: u.name, sent: !!r, date: r?.msg_date || "", read: !!r?.read_at, email: r?.email_status || "", whatsapp: r?.wa_status || "" }; }) });
});
// Send to the audience right now (each person still gets it only once per day).
router.post("/:id/send-now", requireAuth, guard, (req, res) => {
  const m = db.prepare("SELECT * FROM auto_messages WHERE id = ?").get(req.params.id); if (!m) return res.status(404).json({ error: "Not found" });
  if (["birthday", "birthday_team", "anniversary"].includes(m.trigger_type)) return res.status(400).json({ error: "This message goes out by itself on the right day. Use Test To Me to see how it reads." });
  const t = ist(); let sent = 0, skipped = 0;
  if (REMINDERS.includes(m.trigger_type)) {
    const ppl = db.prepare("SELECT id, name, email, phone, department_id FROM users WHERE active = 1").all().filter((x) => inAudience(m, x));
    for (const x of reminderTargets(m.trigger_type, ppl, { ...t, hhmm: "23:59" })) { try { const had = db.prepare("SELECT 1 FROM staff_messages WHERE user_id = ? AND kind = ? AND msg_date = ?").get(x.u.id, "auto:" + m.id, t.date); if (had) { skipped++; continue; } deliver(x.u, m, { kind: "auto:" + m.id, date: t.date, vars: x.vars }); sent++; } catch (e) { console.error("auto message:", e.message); } }
    return res.json({ ok: true, sent, skipped });
  }
  for (const u of db.prepare("SELECT id, name, email, phone, department_id FROM users WHERE active = 1").all().filter((x) => inAudience(m, x))) {
    try { const had = db.prepare("SELECT 1 FROM staff_messages WHERE user_id = ? AND kind = ? AND msg_date = ?").get(u.id, "auto:" + m.id, t.date); if (had) { skipped++; continue; } deliver(u, m, { kind: "auto:" + m.id, date: t.date, vars: { event: "", years: "" } }); sent++; } catch { skipped++; }
  }
  res.json({ ok: true, sent, skipped });
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

// Second set of ready-made messages: morning and evening greetings with a daily motivating line, and reminders for people who forgot something.
(() => {
  try {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'auto_msgs_seeded_v2'").get()) return;
    const add = (title, body, trigger, time) => db.prepare("INSERT INTO auto_messages (id, title, body, trigger_type, send_time, weekdays, audience, whatsapp, active) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), title, body, trigger, time, "1,2,3,4,5,6", "all", 1, /^Good (Morning|Evening)/.test(title) ? 0 : 1);
    db.prepare("UPDATE auto_messages SET active = 0 WHERE title = 'Good Morning Team' AND trigger_type = 'daily'").run();
    add("Good Morning, {name}", "{quote}\n\nHave a wonderful day at Dr. Nishita's Clinic.", "weekly", "08:45");
    add("Good Evening, {name}", "{quote}\n\nThank you for your work today.", "weekly", "19:45");
    add("Please check in, {name}", "Hi {name}, your attendance is not marked yet today. Please check in now.", "attendance_missing", "10:45");
    add("Tasks waiting, {name}", "Hi {name}, you have {count} task(s) waiting: {tasks}. Please complete or update them.", "task_pending", "16:00");
    add("Checklist not submitted, {name}", "Hi {name}, your shift checklist for today is not submitted yet. Please open Work Hub and submit it before you leave.", "checklist_pending", "17:30");
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_msgs_seeded_v2', '1')").run();
  } catch (e) { console.error("auto message defaults v2:", e.message); }
})();

// Morning and evening greetings are paused until the clinic finalises the wording; reminders keep going. Turn them back on from Auto Messages.
(() => {
  try {
    if (db.prepare("SELECT value FROM app_settings WHERE key = 'auto_greetings_paused_v3'").get()) return;
    db.prepare("UPDATE auto_messages SET active = 0 WHERE trigger_type IN ('daily', 'weekly') AND (title LIKE 'Good Morning%' OR title LIKE 'Good Evening%')").run();
    db.prepare("UPDATE auto_messages SET active = 1 WHERE trigger_type = 'checklist_pending'").run();
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_greetings_paused_v3', '1')").run();
  } catch (e) { console.error("auto message pause:", e.message); }
})();

const ist = () => { const d = new Date(Date.now() + 19800000); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16), dow: d.getUTCDay(), md: d.toISOString().slice(5, 10) }; };
const fullName = (u) => String(u.name || "").trim().replace(/\s+/g, " ") || "there";
const fill = (t, u, vars) => {
  const n = ist();
  return String(t).replace(/\{first\}/gi, fullName(u).split(" ")[0]).replace(/\{name\}/gi, fullName(u)).replace(/\{greeting\}/gi, greetingFor(n.hhmm)).replace(/\{quote\}/gi, quoteFor(n.date, n.hhmm))
    .replace(/\{event\}/gi, vars.event || "").replace(/\{years\}/gi, vars.years || "").replace(/\{person\}/gi, vars.person || "").replace(/\{count\}/gi, vars.count || "").replace(/\{tasks\}/gi, vars.tasks || "");
};

/** Reminder messages go only to the people who still have something to do. */
function reminderTargets(type, people, t) {
  const out = [];
  for (const u of people) {
    if (type === "checklist_pending") {
      if (!db.prepare("SELECT shift_role FROM users WHERE id = ?").get(u.id)?.shift_role) continue;
      if (db.prepare("SELECT 1 FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? AND status = 'submitted'").get(u.id, t.date)) continue;
      if (db.prepare("SELECT 1 FROM attendance_marks WHERE user_id = ? AND mark_date = ? AND status IN ('LV','W','A')").get(u.id, t.date)) continue;
      out.push({ u, vars: {} });
    } else if (type === "attendance_missing") {
      const w = shiftOn(u.id, t.date); if (!w.start || w.start > t.hhmm) continue;
      const m = db.prepare("SELECT status, in_time FROM attendance_marks WHERE user_id = ? AND mark_date = ?").get(u.id, t.date);
      if (m && (m.in_time || ["LV", "W", "P", "L", "H"].includes(m.status))) continue;
      if (db.prepare("SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'admin'").get(u.id)) continue;
      out.push({ u, vars: {} });
    } else if (type === "task_pending") {
      const rows = db.prepare("SELECT title FROM tasks WHERE user_id = ? AND status <> 'done' AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date LIMIT 20").all(u.id, t.date);
      if (!rows.length) continue;
      out.push({ u, vars: { count: String(rows.length), tasks: rows.slice(0, 3).map((r) => r.title).join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "") } });
    }
  }
  return out;
}

function deliver(u, m, { kind, date, vars = {} }) {
  const title = fill(m.title, u, vars), body = fill(m.body, u, vars);
  const waNum = String(u.phone || "").replace(/\D/g, ""), wa = !m.whatsapp ? "off" : !telecrmUrl() ? "WhatsApp not connected" : waNum.length < 10 ? "no phone number" : "sent";
  const r = db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body, email_status, wa_status) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(), u.id, kind, date, title, body, u.email ? (isEmailConfigured() ? "sending" : "email not set up") : "no email address", wa);
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
      const celebrants = people.filter((u) => birthdayMD(u.birthday) === t.md);
      for (const c of celebrants) for (const u of people) {
        if (u.id === c.id || !inAudience(m, u)) continue;
        try { deliver(u, m, { kind: `auto:${m.id}:${c.id}`, date: t.date, vars: { person: c.name } }); } catch (e) { console.error("auto message:", e.message); }
      }
      db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id); continue;
    }
    else if (REMINDERS.includes(m.trigger_type)) {
      { const wk = m.weekdays || ""; if (wk && !wk.split(",").includes(String(t.dow))) continue; }
      try { for (const x of reminderTargets(m.trigger_type, people.filter((u) => inAudience(m, u)), t)) deliver(x.u, m, { kind: "auto:" + m.id, date: t.date, vars: x.vars }); } catch (e) { console.error("auto message:", e.message); }
      db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id); continue;
    }
    else if (m.trigger_type === "birthday") targets = people.filter((u) => birthdayMD(u.birthday) === t.md);
    else if (m.trigger_type === "anniversary") targets = people.filter((u) => { if (!u.joined_at) return false; const d = new Date(u.joined_at); return !Number.isNaN(d.getTime()) && d.toISOString().slice(5, 10) === t.md && Number(t.date.slice(0, 4)) - d.getUTCFullYear() >= 1; });
    else if (m.trigger_type === "event") {
      const ev = db.prepare("SELECT title FROM clinic_events WHERE event_date = ? OR event_date = ?").get(t.date, t.md); if (!ev) { db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id); continue; }
      vars = { event: ev.title }; targets = people;
    }
    if (m.audience !== "all") targets = targets.filter((u) => inAudience(m, u));
    try {
      for (const u of targets) {
        const years = m.trigger_type === "anniversary" ? String(Number(t.date.slice(0, 4)) - new Date(u.joined_at).getUTCFullYear()) : "";
        deliver(u, m, { kind: "auto:" + m.id, date: t.date, vars: { ...vars, years } });
      }
    } catch (e) { console.error("auto message:", e.message); }
    db.prepare("UPDATE auto_messages SET last_run = ? WHERE id = ?").run(t.date, m.id);
  }
}
