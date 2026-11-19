// The full Clinic Analysis dashboard (13 sections), shown inside the app on Dashboards -> Patients.
// The file holds patient data, so it is stored on the server disk only (never in the code or on GitHub)
// and only admins and leadership can open it.
import { Router } from "express";
import express from "express";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "../middleware/auth.js";
import { requireLeadership } from "../access.js";
import { randomBytes } from "node:crypto";
import db from "../db.js";
import { audit } from "../audit.js";

const router = Router();
let gz = null;
const get = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const set = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
const key = () => { let k = get("dash_push_key"); if (!k) { k = randomBytes(16).toString("hex"); set("dash_push_key", k); } return k; };
const valid = (b) => typeof b === "string" && b.length > 100000 && /<html/i.test(b) && /sec-suggested/.test(b);
const save = (body) => { const tmp = file() + ".tmp"; fs.writeFileSync(tmp, body); fs.renameSync(tmp, file()); gz = null; set("dash_last_update", new Date().toISOString()); };
// Pull the newest file from the address the nightly job publishes to.
async function pull() {
  const url = get("dash_source_url"); if (!url) throw new Error("No address saved yet.");
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`The address answered ${r.status}.`);
  const t = await r.text(); if (!valid(t)) throw new Error("That address did not give the dashboard file.");
  save(t); set("dash_pull_status", "ok " + new Date().toISOString()); return t.length;
}
if (!process.env.DISABLE_CRON) setInterval(() => { if (get("dash_source_url")) pull().catch((e) => set("dash_pull_status", "failed: " + e.message)); }, 3 * 3600 * 1000).unref?.();

// The nightly job sends the new file here with the key (no sign-in needed). Keep the key private.
router.post("/push", express.text({ type: "*/*", limit: "40mb" }), (req, res) => {
  if (req.query.key !== key()) return res.status(401).json({ error: "wrong key" });
  if (!valid(req.body)) return res.status(400).json({ error: "This is not the clinic dashboard file." });
  save(req.body); res.json({ ok: true, size: req.body.length });
});
router.get("/auto", requireAuth, requireLeadership, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only." });
  res.json({ key: key(), sourceUrl: get("dash_source_url"), status: get("dash_pull_status"), last: get("dash_last_update") });
});
router.post("/auto", requireAuth, requireLeadership, express.json(), async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only." });
  if (typeof req.body.sourceUrl === "string") set("dash_source_url", req.body.sourceUrl.trim());
  if (req.body.pullNow) { try { await pull(); } catch (e) { set("dash_pull_status", "failed: " + e.message); return res.status(400).json({ error: e.message }); } }
  res.json({ ok: true });
});
const dir = () => process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = () => path.join(dir(), "clinic-dashboard.html");

router.get("/info", requireAuth, requireLeadership, (req, res) => {
  try { const s = fs.statSync(file()); res.json({ exists: true, size: s.size, updatedAt: s.mtime.toISOString() }); }
  catch { res.json({ exists: false }); }
});

router.get("/", requireAuth, requireLeadership, (req, res) => {
  if (!fs.existsSync(file())) return res.status(404).json({ error: "The dashboard file has not been added yet." });
  res.set("Cache-Control", "no-store").type("html");
  if (/gzip/.test(req.headers["accept-encoding"] || "")) { // 7 MB of tables shrinks to about 1 MB
    const m = fs.statSync(file()).mtimeMs;
    if (!gz || gz.m !== m) gz = { m, buf: zlib.gzipSync(fs.readFileSync(file()), { level: 6 }) };
    return res.set("Content-Encoding", "gzip").send(gz.buf);
  }
  res.send(fs.readFileSync(file(), "utf8"));
});

router.post("/", requireAuth, requireLeadership, express.text({ type: "*/*", limit: "40mb" }), (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Only the admin can replace the dashboard file." });
  const body = typeof req.body === "string" ? req.body : "";
  if (body.length < 100000 || !/<html/i.test(body) || !/sec-suggested/.test(body)) return res.status(400).json({ error: "This is not the clinic dashboard file." });
  save(body);
  try { audit({ userId: req.user.userId, userName: req.user.name || null, action: "dashboard.file", detail: `${body.length} bytes`, ip: req.ip }); } catch {}
  res.json({ ok: true, size: body.length });
});

export default router;
