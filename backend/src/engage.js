// Warm, human notes to staff about their day (leaving early, staying late, no morning check-in).
// Delivered in the app (a banner) and by email when the person has an email address. WhatsApp: HR gets a ready-to-send link.
import { randomUUID } from "node:crypto";
import db from "./db.js";
import { sendEmail, isEmailConfigured } from "./email.js";

db.exec(`CREATE TABLE IF NOT EXISTS staff_messages (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, msg_date TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, email_status TEXT, read_at TEXT, created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_messages_once ON staff_messages(user_id, msg_date, kind)");

export const enabled = () => (db.prepare("SELECT value FROM app_settings WHERE key = 'engage_enabled'").get()?.value ?? "1") !== "0";

const VARIANTS = {
  early_leave: [
    (n) => ({ title: "Is Everything Alright?", body: `Hi ${n}, we noticed you left a little earlier than usual today. We hope everything is okay. If there is anything we can help with, please let us know. Take care.` }),
    (n) => ({ title: "We Hope You Are Well", body: `Hi ${n}, you headed out a bit early today. We hope all is well at home. If you need any support, your team is always here for you.` }),
  ],
  stayed_late: [
    (n) => ({ title: "Thank You For Today", body: `Hi ${n}, you stayed late today, and we really appreciate your effort. You must be tired. Please rest well tonight. Your dedication does not go unnoticed.` }),
    (n) => ({ title: "You Went the Extra Mile", body: `Hi ${n}, thank you for staying back today. We know it was a long day. Get some good rest, and see you tomorrow with a fresh start.` }),
  ],
  no_morning_checkin: [
    (n) => ({ title: "A Gentle Reminder", body: `Hi ${n}, we could not find your morning check-in today. Your check-out has been noted, and HR will confirm your timings. Please remember to check in when you arrive tomorrow. Thank you.` }),
  ],
};

export function compose(kind, fullName, seed = 0) {
  const list = VARIANTS[kind]; if (!list) return null;
  const first = String(fullName || "").trim().split(/\s+/)[0] || "there";
  return list[seed % list.length](first);
}

const wa = (phone, text) => {
  let d = String(phone || "").replace(/\D/g, ""); if (!d) return null;
  if (d.length === 10) d = "91" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

/** Create the note (once per person, per day, per kind), then email it if possible. Never throws. */
export function engage(userId, kind, date) {
  try {
    if (!enabled()) return null;
    const u = db.prepare("SELECT id, name, email FROM users WHERE id = ? AND active = 1").get(userId); if (!u) return null;
    const m = compose(kind, u.name, Number(date.slice(-2))); if (!m) return null;
    const id = randomUUID();
    const r = db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body) VALUES (?,?,?,?,?,?)").run(id, userId, kind, date, m.title, m.body);
    if (!r.changes) return null;
    if (u.email && isEmailConfigured()) {
      const html = `<p>${m.body}</p><p style="color:#666">Dr. Nishita's Clinic — Work Hub</p>`;
      sendEmail({ to: u.email, subject: m.title, html })
        .then(() => db.prepare("UPDATE staff_messages SET email_status = 'sent' WHERE id = ?").run(id))
        .catch((e) => db.prepare("UPDATE staff_messages SET email_status = ? WHERE id = ?").run("failed: " + String(e.message).slice(0, 80), id));
    } else db.prepare("UPDATE staff_messages SET email_status = ? WHERE id = ?").run(u.email ? "email not set up" : "no email address", id);
    return { id, ...m };
  } catch (e) { console.error("engage:", e.message); return null; }
}

export function waLinkFor(userId, text) {
  const u = db.prepare("SELECT phone FROM users WHERE id = ?").get(userId);
  return wa(u?.phone, text);
}
