import { runBackup } from "./backup.js";
import cron from "node-cron";
import db from "./db.js";
import { withFines } from "./routes/fines.js";
import { stampPayslip, syncLateFines } from "./routes/leave.js";
import { sendEmail, isEmailConfigured } from "./email.js";
import { syncChecklistSheet } from "./routes/shiftChecklist.js";
import { generatePayslipPdf } from "./payslip-pdf.js";
import { randomUUID } from "node:crypto";

function computeNet(p) {
  const earnings = (p.basic_salary || 0) + (p.leave_bonus || 0) + (p.overtime || 0) + (p.other_allowances || 0);
  const deductions = (p.pf || 0) + (p.tds || 0) + (p.other_deductions || 0) + (p.retention || 0);
  return earnings - deductions;
}

/**
 * Generates and emails this month's payslip for every employee with a pay
 * profile. Designed to be safe to run more than once for the same month —
 * INSERT OR REPLACE means re-running just regenerates the same period's slip
 * rather than duplicating it.
 */
export async function runMonthlyPayroll() {
  const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const payDate = new Date().toISOString().slice(0, 10);
  const profiles = db.prepare("SELECT * FROM pay_profiles").all();
  const results = [];

  for (const baseProfile of profiles) {
    const profile = withFines(baseProfile, period);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(profile.user_id);
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(profile.company_id);
    if (!user || !company) continue;

    const netPayable = computeNet(profile);
    const id = randomUUID();
    db.prepare(
      `INSERT OR REPLACE INTO payslips
       (id, user_id, company_id, pay_period, pay_date, basic_salary, leave_bonus, overtime, other_allowances, pf, tds, other_deductions, retention, net_payable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, user.id, company.id, period, payDate,
      profile.basic_salary, profile.leave_bonus, profile.overtime, profile.other_allowances,
      profile.pf, profile.tds, profile.other_deductions, profile.retention, netPayable);

    stampPayslip(id, profile);
    const payslip = db.prepare("SELECT * FROM payslips WHERE id = ?").get(id);
    const pdfPath = generatePayslipPdf({
      company,
      employee: { name: user.name, employeeCode: profile.employee_code, position: profile.position, pan: profile.pan, phone: user.phone, joinedAt: user.joined_at },
      payslip,
    });
    db.prepare("UPDATE payslips SET pdf_path = ? WHERE id = ?").run(pdfPath, id);

    if (isEmailConfigured() && user.email) {
      try {
        await sendEmail({
          to: user.email,
          subject: `Payslip — ${period} — ${company.name}`,
          html: `<p>Hi ${user.name},</p><p>Please find attached your payslip for ${period} from ${company.name}.</p>`,
          attachments: [{ filename: pdfPath.split("/").pop(), path: pdfPath }],
        });
        db.prepare("UPDATE payslips SET emailed_at = datetime('now') WHERE id = ?").run(id);
      } catch (err) {
        db.prepare("UPDATE payslips SET email_error = ? WHERE id = ?").run(err.message, id);
      }
    }
    results.push({ userId: user.id, period, netPayable });
  }
  return results;
}

/**
 * Emails each active staff member (who has an email on file) their currently
 * open tasks. Skips anyone with zero open tasks -- nobody needs an empty
 * checklist email.
 */
export async function runDailyChecklistDigest() {
  if (!isEmailConfigured()) return { sent: 0, skipped: "email not configured" };

  const users = db.prepare("SELECT * FROM users WHERE active = 1 AND email IS NOT NULL").all();
  let sent = 0;
  for (const user of users) {
    const openTasks = db
      .prepare("SELECT title, category, due_date FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY due_date")
      .all(user.id);
    if (openTasks.length === 0) continue;

    const rows = openTasks
      .map((t) => `<li>${t.title}${t.category ? ` <em>(${t.category})</em>` : ""}${t.due_date ? ` — due ${new Date(t.due_date).toLocaleString()}` : ""}</li>`)
      .join("");
    try {
      await sendEmail({
        to: user.email,
        subject: `Today's checklist — ${user.name}`,
        html: `<p>Hi ${user.name},</p><p>Here's what's still open on your checklist:</p><ul>${rows}</ul>`,
      });
      sent++;
    } catch {
      // Non-fatal — one failed email shouldn't stop the rest of the batch.
    }
  }
  return { sent, total: users.length };
}

/**
 * Registers the actual cron schedules. Call once at server startup.
 * Disabled entirely when DISABLE_CRON=true (used by the automated test
 * suite so tests never accidentally trigger real emails).
 */
export function startScheduledJobs() {
  if (process.env.DISABLE_CRON === "true") return;

  // Nightly database backup at 2am, plus one shortly after boot.
  cron.schedule(process.env.BACKUP_CRON || "0 2 * * *", () => { runBackup().catch((e) => console.error("Backup failed:", e)); });
  setTimeout(() => runBackup().catch((e) => console.error("Backup failed:", e)), 15000).unref();

  // Pull the old Google sheet's checklist log into the app every 10 minutes (only does anything once a sheet link is saved).
  cron.schedule("30 23 * * *", () => { try { syncLateFines(new Date(Date.now() + 19800000).toISOString().slice(0, 7)); } catch (e) { console.error("Late fines:", e.message); } }, { timezone: "Asia/Kolkata" });
  cron.schedule("*/10 * * * *", () => { syncChecklistSheet().catch((e) => console.error("Checklist sync failed:", e.message)); });
  setTimeout(() => syncChecklistSheet().catch(() => {}), 20000).unref();

  const payrollSchedule = process.env.PAYROLL_CRON || "0 9 1 * *"; // 9am on the 1st of each month
  const digestSchedule = process.env.CHECKLIST_DIGEST_CRON || "0 8 * * *"; // 8am daily

  cron.schedule(payrollSchedule, () => {
    runMonthlyPayroll().catch((err) => console.error("Monthly payroll job failed:", err));
  });

  cron.schedule(digestSchedule, () => {
    runDailyChecklistDigest().catch((err) => console.error("Checklist digest job failed:", err));
  });

  console.log(`Scheduled jobs registered: payroll="${payrollSchedule}", checklist digest="${digestSchedule}"`);
}
