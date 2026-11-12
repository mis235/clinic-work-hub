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

const MOOD = { early_leave: "worried and caring: they left earlier than usual, so check gently that all is well", stayed_late: "grateful and warm: they stayed late, so thank them and tell them to rest", no_morning_checkin: "polite and gentle: no morning check-in was found, HR will confirm timings" };
/** Ask Claude to write the note in a human way for this mood. Returns null if no key or any problem (the ready wording is used). */
async function aiBody(kind, name, fallback, outTime) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key || !MOOD[kind]) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 160,
        system: "You write short, kind messages from Dr. Nishita's Clinic to a staff member. Simple English, 2 to 3 sentences, no emojis, no quotes, no judgement, never mention fines or salary. Start with Hi and the first name. Reply with the message only.",
        messages: [{ role: "user", content: `Staff first name: ${name}. Tone: ${MOOD[kind]}.${outTime ? ` They checked out at ${outTime}.` : ""} Example of the idea: ${fallback}` }] }),
    });
    const d = await r.json(); const t = d?.content?.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return r.ok && t && t.length < 600 ? t : null;
  } catch { return null; }
}

/** Create the note (once per person, per day, per kind), then email it if possible. Never throws. */
export function engage(userId, kind, date) {
  try {
    if (!enabled()) return null;
    const u = db.prepare("SELECT id, name, email FROM users WHERE id = ? AND active = 1").get(userId); if (!u) return null;
    const m = compose(kind, u.name, Number(date.slice(-2))); if (!m) return null;
    const id = randomUUID();
    const r = db.prepare("INSERT OR IGNORE INTO staff_messages (id, user_id, kind, msg_date, title, body) VALUES (?,?,?,?,?,?)").run(id, userId, kind, date, m.title, m.body);
    if (!r.changes) return null;
    (async () => {   // wording by AI when a key is set, then the email
      const ai = await aiBody(kind, String(u.name || "").trim().split(/\s+/)[0] || "there", m.body, null);
      if (ai) { m.body = ai; db.prepare("UPDATE staff_messages SET body = ? WHERE id = ?").run(ai, id); }
      if (u.email && isEmailConfigured()) {
        const html = `<p>${m.body}</p><p style="color:#666">Dr. Nishita's Clinic — Work Hub</p>`;
        await sendEmail({ to: u.email, subject: m.title, html })
          .then(() => db.prepare("UPDATE staff_messages SET email_status = 'sent' WHERE id = ?").run(id))
          .catch((e) => db.prepare("UPDATE staff_messages SET email_status = ? WHERE id = ?").run("failed: " + String(e.message).slice(0, 80), id));
      } else db.prepare("UPDATE staff_messages SET email_status = ? WHERE id = ?").run(u.email ? "email not set up" : "no email address", id);
    })().catch(() => {});
    return { id, ...m };
  } catch (e) { console.error("engage:", e.message); return null; }
}

export function waLinkFor(userId, text) {
  const u = db.prepare("SELECT phone FROM users WHERE id = ?").get(userId);
  return wa(u?.phone, text);
}
