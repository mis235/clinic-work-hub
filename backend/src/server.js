import { documentsRouter, templatesRouter, linksRouter } from "./routes/documents.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import taskRoutes from "./routes/tasks.js";
import webhookRoutes from "./routes/webhook.js";
import attendanceRoutes from "./routes/attendance.js";
import templateRoutes from "./routes/templates.js";
import advisorRoutes from "./routes/advisors.js";
import policyRoutes from "./routes/policies.js";
import reportRoutes from "./routes/reports.js";
import hrRoutes from "./routes/hr.js";
import companyRoutes from "./routes/companies.js";
import payrollRoutes from "./routes/payroll.js";
import assistantRoutes from "./routes/assistant.js";
import shiftChecklistRoutes from "./routes/shiftChecklist.js";
import { requireAuth, requirePermission } from "./middleware/auth.js";
import { runMonthlyPayroll, runDailyChecklistDigest, startScheduledJobs } from "./cron.js";
import db from "./db.js"; // ensures tables exist on boot
import fs from "node:fs";
import { securityHeaders, checkEnv } from "./security.js";
import { auditMiddleware } from "./audit.js";
import { runBackup, listBackups, backupDir } from "./backup.js";

const envProblems = checkEnv();
if (envProblems.length) {
  console.error("\nCannot start — fix these settings first:\n - " + envProblems.join("\n - ") + "\n");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1); // behind Render's proxy: gives the real client IP
app.disable("x-powered-by");

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(securityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use(auditMiddleware);

const startedAt = Date.now();
app.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, db: "ok", uptimeSec: Math.round((Date.now() - startedAt) / 1000), time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down" });
  }
});

// Admin-only: system status, activity log and backups.
const adminOnly = [requireAuth, requirePermission("payroll:manage")];
app.get("/api/admin/status", ...adminOnly, (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const backups = listBackups();
  res.json({
    ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    users: count("users"), tasks: count("tasks"), shiftSubmissions: count("shift_checklist_submissions"),
    lastBackup: backups[0] || null, backups: backups.length,
    whatsappConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN, emailConfigured: !!process.env.GMAIL_USER,
    aiConfigured: !!process.env.ANTHROPIC_API_KEY, persistentDisk: !!process.env.DATA_DIR,
  });
});
app.get("/api/admin/audit", ...adminOnly, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit));
});
app.get("/api/admin/backups", ...adminOnly, (req, res) => res.json(listBackups()));
app.post("/api/admin/backups", ...adminOnly, async (req, res) => {
  try { res.status(201).json({ ok: true, file: await runBackup() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/admin/backups/:name", ...adminOnly, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(backupDir, name);
  if (!name.endsWith(".db") || !fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  res.download(file);
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/advisors", advisorRoutes);
app.use("/api/policies", policyRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/hr", hrRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/documents", documentsRouter);
app.use("/api/doc-templates", templatesRouter);
app.use("/api/links", linksRouter);
app.use("/api/payroll", payrollRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/shift-checklist", shiftChecklistRoutes);
app.use("/webhook", webhookRoutes); // GET+POST /webhook/whatsapp

// Serves uploaded shift-checklist photo evidence. Not permission-gated at the
// file level (URLs are random UUIDs, not guessable/listable) — matches how the
// photo links worked in the Apps Script version (a Drive "anyone with link" URL).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/uploads", express.static(path.join(process.env.DATA_DIR || path.join(__dirname, ".."), "uploads")));

// Manual triggers for the two scheduled jobs — useful for testing without
// waiting for the actual cron time, and as a manual "send now" override.
app.post("/api/jobs/run-monthly-payroll", requireAuth, requirePermission("payroll:manage"), async (req, res) => {
  try {
    const results = await runMonthlyPayroll();
    res.json({ ok: true, generated: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/jobs/run-checklist-digest", requireAuth, requirePermission("reports:view"), async (req, res) => {
  try {
    res.json(await runDailyChecklistDigest());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hosted mode: the same server also serves the built React app, so the whole clinic
// app lives at one https address (no CORS, nothing else to host).
const distDir = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|webhook|uploads|health).*/, (req, res) => res.sendFile(path.join(distDir, "index.html")));
}

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// First boot on a fresh (empty) database: load the staff, roles, checklists and policies.
if (db.prepare("SELECT COUNT(*) AS c FROM users").get().c === 0) {
  console.log("Empty database — running first-time seed…");
  await import("./seed.js");
}

// Anyone still on the shared starter PIN (1234) must choose their own at next sign-in.
{
  const rows = db.prepare(`SELECT u.id, u.pin_hash FROM users u JOIN roles r ON r.id = u.role_id
                           WHERE u.pin_hash IS NOT NULL AND u.must_change_pin = 0 AND r.name != 'admin'`).all();
  const { default: bcrypt } = await import("bcryptjs");
  for (const r of rows) {
    if (bcrypt.compareSync("1234", r.pin_hash)) db.prepare("UPDATE users SET must_change_pin = 1 WHERE id = ?").run(r.id);
  }
}

const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log(`Clinic Work Hub API listening on http://localhost:${port}`);
  startScheduledJobs();
});

// Clean shutdown so a redeploy never cuts a database write in half.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); });
}
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
