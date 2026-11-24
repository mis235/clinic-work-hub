import "dotenv/config"; // MUST stay the first line: every other file reads its settings from backend/.env when it loads
import { documentsRouter, templatesRouter, linksRouter } from "./routes/documents.js";
import finesRoutes from "./routes/fines.js";
import groomingRoutes from "./routes/grooming.js";
import portalRoutes from "./routes/portal.js";
import "./libraryImport.js";
import helpdeskRoutes from "./routes/helpdesk.js";
import chatRoutes from "./routes/chat.js";
import rosterRoutes from "./routes/roster.js";
import exitRoutes from "./routes/exits.js";
import workspaceRoutes from "./routes/workspace.js";
import kioskRoutes from "./routes/kiosk.js";
import messageRoutes from "./routes/messages.js";
import roomRoutes from "./routes/rooms.js";
import sheetRoutes from "./routes/sheets.js";
import autoMessageRoutes from "./routes/autoMessages.js";
import leaveRoutes from "./routes/leave.js";
import { tidyExistingNames } from "./names.js";
import { ensureSingleAdmin, requireLeadership, seedAccess } from "./access.js";
import { startHttps } from "./https.js";
import { payslipCc, savePayslipCc, cleanCcList, DEFAULT_SENDER, isEmailConfigured, mailSettings, saveMailSettings, clearMailSettings, sendEmail, friendlyMailError } from "./email.js";
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
import libraryRoutes from "./routes/library.js";
import reportRoutes from "./routes/reports.js";
import hrRoutes from "./routes/hr.js";
import companyRoutes from "./routes/companies.js";
import payrollRoutes from "./routes/payroll.js";
import assistantRoutes from "./routes/assistant.js";
import shiftChecklistRoutes from "./routes/shiftChecklist.js";
import clinicAiRoutes from "./routes/clinicAi.js";
import liveNumbersRoutes from "./routes/liveNumbers.js";
import clinicDashboardRoutes from "./routes/clinicDashboard.js";
import staffImportRoutes from "./routes/staffImport.js";
import { requireAuth, requirePermission } from "./middleware/auth.js";
import { runMonthlyPayroll, runDailyChecklistDigest, startScheduledJobs } from "./cron.js";
import db from "./db.js"; // ensures tables exist on boot
import fs from "node:fs";
import { securityHeaders, checkEnv } from "./security.js";
import { auditMiddleware } from "./audit.js";
import { runBackup, listBackups, backupDir, copyFolder, setCopyFolder, includeBig, setIncludeBig, backupTime, setBackupTime, copyStatus, storageReport, cleanSnapshots } from "./backup.js";

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

// The AI key can be saved from the System page (kept on this server); a key in .env still works.
try { const k = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_key'").get()?.value; if (k && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = k; } catch {}

// Admin-only: system status, activity log and backups.
const adminOnly = [requireAuth, requirePermission("payroll:manage")];
app.put("/api/admin/ai-key", ...adminOnly, (req, res) => {
  const k = String(req.body?.key || "").trim();
  if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) return res.status(400).json({ error: "That does not look like an Anthropic key (it starts with sk-ant-)" });
  if (k) { db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('anthropic_key', ?)").run(k); process.env.ANTHROPIC_API_KEY = k; }
  else { db.prepare("DELETE FROM app_settings WHERE key = 'anthropic_key'").run(); delete process.env.ANTHROPIC_API_KEY; }
  res.json({ ok: true, configured: !!k });
});
app.get("/api/admin/status", ...adminOnly, (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const backups = listBackups();
  res.json({
    ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    users: count("users"), tasks: count("tasks"), shiftSubmissions: count("shift_checklist_submissions"),
    lastBackup: backups[0] || null, backups: backups.length,
    whatsappConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN || !!db.prepare("SELECT value FROM app_settings WHERE key = 'telecrm_webhook'").get()?.value, emailConfigured: isEmailConfigured(),
    aiConfigured: !!process.env.ANTHROPIC_API_KEY, persistentDisk: !!process.env.DATA_DIR,
  });
});
// Email (payslips, digest): settings saved here so nobody has to edit backend/.env
app.get("/api/admin/email", ...adminOnly, (req, res) => { const m = mailSettings(); res.json({ configured: isEmailConfigured(), user: m.user || DEFAULT_SENDER, hasPassword: !!m.pass, cc: payslipCc() }); });
app.put("/api/admin/email", ...adminOnly, (req, res) => {
  const { user, pass, cc } = req.body || {};
  if (cc !== undefined && !cleanCcList(cc)) return res.status(400).json({ error: "Check the CC email addresses" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(user || ""))) return res.status(400).json({ error: "Enter the Gmail address that will send the emails" });
  if (!pass && !mailSettings().pass) return res.status(400).json({ error: "Enter the app password" });
  saveMailSettings({ user, pass }); if (cc !== undefined) savePayslipCc(cc); res.json({ ok: true });
});
app.delete("/api/admin/email", ...adminOnly, (req, res) => { clearMailSettings(); res.json({ ok: true }); });
app.post("/api/admin/email/test", ...adminOnly, async (req, res) => {
  const to = String(req.body?.to || "").trim() || mailSettings().user;
  try {
    await sendEmail({ to, subject: "Work Hub test email", html: "<p>This is a test from the clinic Work Hub. If you can read this, payslips can be emailed.</p>" });
    res.json({ ok: true, to });
  } catch (e) { res.status(400).json({ error: friendlyMailError(e) }); }
});
app.get("/api/admin/audit", ...adminOnly, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit));
});
// Extra backup copy (e.g. a Google Drive folder) + storage report + clean-up of old check-in photos
app.get("/api/admin/backup-copy", ...adminOnly, (req, res) => res.json({ dir: copyFolder(), includeBig: includeBig(), time: backupTime(), status: copyStatus() }));
app.put("/api/admin/backup-copy", ...adminOnly, async (req, res) => {
  try {
    if (req.body?.includeBig !== undefined) setIncludeBig(!!req.body.includeBig);
    if (req.body?.time) setBackupTime(req.body.time);
    const dir = setCopyFolder(req.body?.dir ?? copyFolder());
    if (dir) await runBackup();
    res.json({ dir, includeBig: includeBig(), time: backupTime(), status: copyStatus() });
  } catch (e) { res.status(400).json({ error: "That folder can't be used: " + e.message }); }
});
app.get("/api/admin/storage", ...adminOnly, (req, res) => res.json(storageReport()));
app.post("/api/admin/cleanup-snapshots", ...adminOnly, (req, res) => {
  const days = Math.max(7, Number(req.body?.days) || 90);
  res.json({ days, ...cleanSnapshots(days) });
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
app.use("/api/advisors", requireAuth, requireLeadership, advisorRoutes);
app.use("/api/policies", policyRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/reports", requireAuth, (req, res, next) => (req.path === "/my-summary" ? next() : requireLeadership(req, res, next)), reportRoutes);   // /my-summary is each person's own numbers
app.use("/api/hr", hrRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/documents", documentsRouter);
app.use("/api/doc-templates", templatesRouter);
app.use("/api/links", linksRouter);
app.use("/api/fines", finesRoutes);
app.use("/api/grooming", groomingRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/helpdesk", helpdeskRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/roster", rosterRoutes);
app.use("/api/exits", exitRoutes);
app.use("/api/workspace", workspaceRoutes);
app.use("/api/kiosk", kioskRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/sheets", sheetRoutes);
app.use("/api/auto-messages", autoMessageRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/shift-checklist", shiftChecklistRoutes);
app.use("/api/clinic-ai", clinicAiRoutes);
app.use("/api/live-numbers", liveNumbersRoutes);
app.use("/api/clinic-dashboard", clinicDashboardRoutes);
app.use("/api/staff-import", staffImportRoutes);
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
  // The Check-in app's manifest carries the phone's key in its start address, so a home-screen icon (iPhone keeps separate storage) still opens already set up.
  app.get("/kiosk.webmanifest", (req, res) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(distDir, "kiosk.webmanifest"), "utf8"));
      const k = String(req.query.key || "");
      if (/^[\w.-]{20,1000}$/.test(k)) m.start_url = "/kiosk?key=" + k;
      res.set("Cache-Control", "no-cache").type("application/manifest+json").send(JSON.stringify(m));
    } catch { res.sendFile(path.join(distDir, "kiosk.webmanifest")); }
  });
  app.use(express.static(distDir));
  // The Check-in page is its own installable app: its page head carries the Check-in name, icon and manifest from the first byte,
  // so "Install" on that page never installs the Work Hub by mistake.
  app.get(/^\/kiosk\/?$/, (req, res) => {
    try {
      const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8")
        .replace('href="/manifest.json"', 'href="/kiosk.webmanifest"')
        .replace('<meta name="theme-color" content="#C42F8F"', '<meta name="theme-color" content="#2a1b3d"')
        .replace('content="Work Hub" />', 'content="Check-in" />')
        .replace('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />', '<link rel="apple-touch-icon" href="/kiosk-apple-touch-icon.png" />')
        .replace('<link rel="icon" type="image/png" href="/icon-192.png" />', '<link rel="icon" type="image/png" href="/kiosk-192.png" />')
        .replace(/<title>[^<]*<\/title>/, "<title>Clinic Check-in</title>");
      res.set("Cache-Control", "no-cache").type("html").send(html);
    } catch { res.sendFile(path.join(distDir, "index.html")); }
  });
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

// Only the ADMIN_EMAIL account is admin; everyone else is staff.
seedAccess();
ensureSingleAdmin();
try { tidyExistingNames(db); } catch (e) { console.warn("name tidy skipped:", e.message); }

const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log(`Clinic Work Hub API listening on http://localhost:${port}`);
  startScheduledJobs();
});

await startHttps(app);

// Clean shutdown so a redeploy never cuts a database write in half.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); });
}
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
