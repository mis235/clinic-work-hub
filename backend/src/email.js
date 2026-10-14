import nodemailer from "nodemailer";
import db from "./db.js";

// Email settings can be saved from the app (System page) or come from backend/.env (GMAIL_USER / GMAIL_APP_PASSWORD).
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
const getSetting = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const putSetting = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function mailSettings() {
  const user = getSetting("mail_user") || process.env.GMAIL_USER || "";
  const pass = getSetting("mail_pass") || process.env.GMAIL_APP_PASSWORD || "";
  return { user, pass: String(pass).replace(/\s+/g, "") }; // Google shows app passwords in groups of 4 with spaces
}
export function saveMailSettings({ user, pass }) {
  putSetting("mail_user", String(user || "").trim());
  if (pass) putSetting("mail_pass", String(pass).replace(/\s+/g, ""));
  cached = null;
}
export function clearMailSettings() { db.prepare("DELETE FROM app_settings WHERE key IN ('mail_user','mail_pass')").run(); cached = null; }

let cached = null;
function getTransporter() {
  const { user, pass } = mailSettings();
  if (!user || !pass) return null;
  const sig = `${user}|${pass}`;
  if (cached?.sig === sig) return cached.t;
  const t = process.env.MAIL_DRY_RUN
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  cached = { sig, t };
  return t;
}

export function isEmailConfigured() {
  const { user, pass } = mailSettings();
  return Boolean(user && pass);
}

// Turn Gmail's technical errors into something a person can act on.
export function friendlyMailError(e) {
  const m = String(e?.message || e);
  if (/Invalid login|Username and Password not accepted|535|BadCredentials/i.test(m)) return "Gmail did not accept this address / app password. Use a Google 'App password' (16 letters), not your normal password.";
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/i.test(m)) return "Could not reach Gmail. Check the computer's internet connection.";
  if (/not configured/i.test(m)) return m;
  return m;
}

/** Sends an email through Gmail using an App Password. */
export async function sendEmail({ to, subject, html, attachments }) {
  const t = getTransporter();
  if (!t) throw new Error("Email is not set up yet. Open System & Backups → Email settings and add the clinic Gmail address and app password.");
  const { user } = mailSettings();
  return t.sendMail({ from: `"Dr. Nishita's Clinic — Work Hub" <${user}>`, to, subject, html, attachments });
}
