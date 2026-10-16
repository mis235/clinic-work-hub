import { Router } from "express";
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
  let data; try { data = JSON.parse(text); } catch { return text.trim(); }
  if (Array.isArray(data)) data = data[0];
  if (typeof data === "string") return data;
  return data?.output ?? data?.text ?? data?.message ?? data?.response ?? data?.reply ?? JSON.stringify(data);
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

export default router;
