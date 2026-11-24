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
// Pull the newest file: from the private GitHub data repo if one is saved, else from the saved address.
async function pull() {
  const repo = get("dash_gh_repo"), tok = get("dash_gh_token"), url = get("dash_source_url");
  let r;
  if (repo && tok) {
    const gpath = get("dash_gh_path") || "clinic-dashboard.html", etag = get("dash_gh_etag");
    r = await fetch(`https://api.github.com/repos/${repo}/contents/${gpath.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github.raw+json", "User-Agent": "clinic-work-hub", ...(etag ? { "If-None-Match": etag } : {}) },
      redirect: "follow", signal: AbortSignal.timeout(120000) });
    if (r.status === 304) { set("dash_pull_status", "ok " + new Date().toISOString()); return 0; }
    if (r.status === 401 || r.status === 403) throw new Error("GitHub did not accept the token.");
    if (r.status === 404) throw new Error("GitHub could not find that repo or file yet.");
    if (r.ok && r.headers.get("etag")) set("dash_gh_etag", r.headers.get("etag"));
  } else {
    if (!url) throw new Error("No address saved yet.");
    r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  }
  if (!r.ok) throw new Error(`The address answered ${r.status}.`);
  const t = await r.text();
  if (!valid(t)) { set("dash_gh_etag", ""); throw new Error("That did not give the dashboard file."); } // old file stays
  save(t); set("dash_pull_status", "ok " + new Date().toISOString()); return t.length;
}
if (!process.env.DISABLE_CRON) setInterval(() => { if (get("dash_source_url") || (get("dash_gh_repo") && get("dash_gh_token"))) pull().catch((e) => set("dash_pull_status", "failed: " + e.message)); }, 20 * 60 * 1000).unref?.(); // every 20 minutes (nothing is downloaded unless GitHub has a newer file)

// The nightly job sends the new file here with the key (no sign-in needed). Keep the key private.
router.post("/push", express.text({ type: "*/*", limit: "40mb" }), (req, res) => {
  if (req.query.key !== key()) return res.status(401).json({ error: "wrong key" });
  if (!valid(req.body)) return res.status(400).json({ error: "This is not the clinic dashboard file." });
  save(req.body); res.json({ ok: true, size: req.body.length });
});
router.get("/auto", requireAuth, requireLeadership, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only." });
  res.json({ key: key(), sourceUrl: get("dash_source_url"), ghRepo: get("dash_gh_repo"), ghPath: get("dash_gh_path"), hasToken: !!get("dash_gh_token"), status: get("dash_pull_status"), last: get("dash_last_update") });
});
router.post("/auto", requireAuth, requireLeadership, express.json(), async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only." });
  if (typeof req.body.sourceUrl === "string") set("dash_source_url", req.body.sourceUrl.trim());
  if (typeof req.body.ghRepo === "string") { const v = req.body.ghRepo.trim(); if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) return res.status(400).json({ error: "Repo should look like owner/name." }); set("dash_gh_repo", v); set("dash_gh_etag", ""); }
  if (typeof req.body.ghPath === "string") set("dash_gh_path", req.body.ghPath.trim());
  if (typeof req.body.ghToken === "string" && req.body.ghToken.trim()) { set("dash_gh_token", req.body.ghToken.trim()); set("dash_gh_etag", ""); }
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
