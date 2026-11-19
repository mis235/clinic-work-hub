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
import { audit } from "../audit.js";

const router = Router();
let gz = null;
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
  const tmp = file() + ".tmp"; fs.writeFileSync(tmp, body); fs.renameSync(tmp, file());
  try { audit({ userId: req.user.userId, userName: req.user.name || null, action: "dashboard.file", detail: `${body.length} bytes`, ip: req.ip }); } catch {}
  res.json({ ok: true, size: body.length });
});

export default router;
