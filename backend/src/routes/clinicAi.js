import express, { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLeadership } from "../access.js";
import { audit } from "../audit.js";

// Clinic AI = the clinic's n8n "Data Analyst" workflow, reached through its chat link.
// The browser never talks to n8n directly: this server forwards the question, so the link stays private
// and only leadership can use it (it can answer about patients and revenue).
const router = Router();
const getSetting = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const putSetting = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function cleanChatUrl(u) {
  const url = String(u || "").trim();
  if (!/^https?:\/\/[^\s/]+\/webhook\/[A-Za-z0-9-]+(\/chat)?\/?$/.test(url)) return "";
  return url.replace(/\/+$/, "").replace(/\/chat$/, "") + "/chat";
}

router.get("/config", requireAuth, requireLeadership, (req, res) => {
  const url = getSetting("clinic_ai_url");
  res.json({ configured: !!url, url: req.user.roleName === "admin" ? url : undefined });
});

router.put("/config", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only the admin can change this." });
  const raw = String(req.body?.url || "").trim();
  if (!raw) { putSetting("clinic_ai_url", ""); return res.json({ ok: true, configured: false }); }
  const url = cleanChatUrl(raw);
  if (!url) return res.status(400).json({ error: "That does not look like the n8n chat link. It should look like https://your-n8n-address/webhook/…/chat" });
  putSetting("clinic_ai_url", url);
  audit({ userId: req.user.userId, action: "CLINIC_AI_LINK_SET" });
  res.json({ ok: true, configured: true });
});

function pickReply(text) {
  let data; try { data = JSON.parse(text); } catch { const m = /"responseText"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text); if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1].replace(/\\n/g, "\n"); } } return text.trim(); }
  if (Array.isArray(data)) data = data[0];
  if (typeof data === "string") return data;
  return data?.responseText ?? data?.output ?? data?.text ?? data?.message ?? data?.response ?? data?.reply ?? JSON.stringify(data);
}

router.post("/ask", requireAuth, requireLeadership, async (req, res) => {
  const url = getSetting("clinic_ai_url");
  if (!url) return res.status(400).json({ error: "Clinic AI is not connected yet. Admin: paste the n8n chat link on this page." });
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: "Type a question first." });
  const sessionId = `hub-${req.user.userId}`;
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendMessage", sessionId, chatInput: message }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: r.status === 404 ? "n8n says this chat link does not exist. Check the link and that the workflow is Active (switched on)." : `n8n returned an error (${r.status}).` });
    res.json({ reply: pickReply(text) || "(No answer came back.)" });
  } catch (e) {
    res.status(502).json({ error: e.name === "TimeoutError" ? "n8n took too long to answer. Try a shorter question." : "Could not reach n8n from this computer. Check the address and that n8n is running." });
  }
});

// ---- Patient Dashboard: the clinic's own dashboard page (one HTML file) stored privately on the server ----------------
// Uploaded by the admin; shown only to admin + leadership. It never goes into GitHub.
const PD_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "private");
const PD_FILE = path.join(PD_DIR, "patient-dashboard.html");
router.get("/patient-dashboard", requireAuth, requireLeadership, (req, res) => {
  if (!fs.existsSync(PD_FILE)) return res.status(404).json({ error: "The patient dashboard has not been uploaded yet." });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Expose-Headers", "X-File-Updated");
  res.setHeader("X-File-Updated", fs.statSync(PD_FILE).mtime.toISOString());
  res.send(fs.readFileSync(PD_FILE));
});
// Keep the dashboard in step with the Claude "Clinic Dashboard" project: the finished .html is saved to a Google Drive file
// (shared "Anyone with the link") and the app pulls it by itself, so nobody has to download and upload it each time.
const sget = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const sput = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
const driveId = (u) => /\/d\/([A-Za-z0-9_-]{15,})|[?&]id=([A-Za-z0-9_-]{15,})/.exec(String(u || "")) ;
export async function pullDashboard() {
  const url = sget("pd_source"); if (!url) return { ok: false, message: "No Drive link saved yet." };
  const m = driveId(url); const id = m && (m[1] || m[2]);
  const status = (message, ok = false, changed = false) => { sput("pd_pull_status", JSON.stringify({ at: new Date().toISOString(), ok, message, changed })); return { ok, message, changed }; };
  if (!id) return status("That is not a Google Drive file link.");
  try {
    const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { redirect: "follow", signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.length < 200 || !/<html|<!doctype/i.test(buf.subarray(0, 2000).toString("utf8"))) return status("Could not read it. In Google Drive set the file to Anyone with the link, Viewer.");
    fs.mkdirSync(PD_DIR, { recursive: true });
    const same = fs.existsSync(PD_FILE) && fs.readFileSync(PD_FILE).equals(buf);
    if (!same) fs.writeFileSync(PD_FILE, buf);
    return status(same ? "Already the latest." : "Updated from Drive.", true, !same);
  } catch (e) { return status("Could not reach Drive: " + e.message); }
}
router.get("/patient-dashboard/source", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  let st = null; try { st = JSON.parse(sget("pd_pull_status") || "null"); } catch {}
  res.json({ url: sget("pd_source"), status: st });
});
router.put("/patient-dashboard/source", requireAuth, async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const url = String(req.body?.url || "").trim();
  if (url && !driveId(url)) return res.status(400).json({ error: "Paste the Google Drive link of the dashboard .html file" });
  sput("pd_source", url);
  res.json(url ? await pullDashboard() : { ok: true, message: "Auto-update turned off." });
});
router.post("/patient-dashboard/pull", requireAuth, async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  res.json(await pullDashboard());
});
router.put("/patient-dashboard", requireAuth, express.raw({ type: "*/*", limit: "40mb" }), (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only the admin can upload this." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 200 || !/<html|<!doctype/i.test(buf.subarray(0, 2000).toString("utf8"))) return res.status(400).json({ error: "That does not look like the dashboard .html file." });
  fs.mkdirSync(PD_DIR, { recursive: true });
  fs.writeFileSync(PD_FILE, buf);
  audit({ userId: req.user.userId, action: "PATIENT_DASHBOARD_UPLOADED" });
  res.json({ ok: true, bytes: buf.length });
});

export default router;
