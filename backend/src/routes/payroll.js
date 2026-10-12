import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { generatePayslipPdf } from "../payslip-pdf.js";
import { sendEmail, isEmailConfigured } from "../email.js";

const router = Router();

// GET /api/payroll/companies is served by routes/companies.js — this file is payslips/profiles only.

// GET /api/payroll/profile/:userId — admin: any profile. Staff: only their own.
router.get("/profile/:userId", requireAuth, (req, res) => {
  if (req.user.userId !== req.params.userId) {
    const granted = db
      .prepare(`SELECT p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
      .all(req.user.roleId).map((r) => r.action);
    if (!granted.includes("payroll:manage")) return res.status(403).json({ error: "Not authorized" });
  }
  const profile = db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(req.params.userId);
  res.json(profile || null);
});

// POST /api/payroll/profile — admin sets/updates a user's recurring pay structure
router.post("/profile", requireAuth, requirePermission("payroll:manage"), (req, res) => {
  const { userId, companyId, employeeCode, position, pan, basicSalary, leaveBonus, overtime, otherAllowances, pf, tds, otherDeductions, retention } = req.body || {};
  if (!userId || !companyId) return res.status(400).json({ error: "userId and companyId are required" });
  db.prepare(
    `INSERT INTO pay_profiles (user_id, company_id, employee_code, position, pan, basic_salary, leave_bonus, overtime, other_allowances, pf, tds, other_deductions, retention, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       company_id=excluded.company_id, employee_code=excluded.employee_code, position=excluded.position, pan=excluded.pan,
       basic_salary=excluded.basic_salary, leave_bonus=excluded.leave_bonus, overtime=excluded.overtime,
       other_allowances=excluded.other_allowances, pf=excluded.pf, tds=excluded.tds,
       other_deductions=excluded.other_deductions, retention=excluded.retention, updated_at=datetime('now')`
  ).run(userId, companyId, employeeCode || null, position || null, pan || null,
    basicSalary || 0, leaveBonus || 0, overtime || 0, otherAllowances || 0, pf || 0, tds || 0, otherDeductions || 0, retention || 0);
  res.json({ ok: true });
});

// GET /api/payroll/profiles — admin: list every employee's pay profile (for the payroll admin screen)
router.get("/profiles", requireAuth, requirePermission("payroll:manage"), (req, res) => {
  const rows = db.prepare(
    `SELECT pp.*, u.name, u.email FROM pay_profiles pp JOIN users u ON u.id = pp.user_id ORDER BY u.name`
  ).all();
  res.json(rows);
});

function computeNet(p) {
  const earnings = (p.basic_salary || 0) + (p.leave_bonus || 0) + (p.overtime || 0) + (p.other_allowances || 0);
  const deductions = (p.pf || 0) + (p.tds || 0) + (p.other_deductions || 0) + (p.retention || 0);
  return earnings - deductions;
}

async function generateOneSlip({ profile, period, payDate, adminUserId, sendNow }) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(profile.user_id);
  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(profile.company_id);
  const netPayable = computeNet(profile);
  const id = randomUUID();

  db.prepare(
    `INSERT OR REPLACE INTO payslips
     (id, user_id, company_id, pay_period, pay_date, basic_salary, leave_bonus, overtime, other_allowances, pf, tds, other_deductions, retention, net_payable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user.id, company.id, period, payDate,
    profile.basic_salary, profile.leave_bonus, profile.overtime, profile.other_allowances,
    profile.pf, profile.tds, profile.other_deductions, profile.retention, netPayable);

  const payslip = db.prepare("SELECT * FROM payslips WHERE id = ?").get(id);
  const pdfPath = generatePayslipPdf({
    company,
    employee: { name: user.name, employeeCode: profile.employee_code, position: profile.position, pan: profile.pan, phone: user.phone, joinedAt: user.joined_at },
    payslip,
  });
  db.prepare("UPDATE payslips SET pdf_path = ? WHERE id = ?").run(pdfPath, id);

  if (sendNow && user.email) {
    try {
      await sendEmail({
        to: user.email,
        subject: `Payslip — ${period} — ${company.name}`,
        html: `<p>Hi ${user.name},</p><p>Please find attached your payslip for ${period} from ${company.name}.</p>`,
        attachments: [{ filename: pdfPath.split("/").pop(), path: pdfPath }],
      });
      db.prepare("UPDATE payslips SET emailed_at = datetime('now'), email_error = NULL WHERE id = ?").run(id);
    } catch (err) {
      db.prepare("UPDATE payslips SET email_error = ? WHERE id = ?").run(err.message, id);
    }
  }

  return db.prepare("SELECT * FROM payslips WHERE id = ?").get(id);
}

// POST /api/payroll/generate — admin triggers generation for one or all employees for a given month.
// body: { period: 'YYYY-MM', userId?: string (omit for all), sendEmail?: boolean }
router.post("/generate", requireAuth, requirePermission("payroll:manage"), async (req, res) => {
  const { period, userId, sendEmail: shouldSend } = req.body || {};
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be 'YYYY-MM'" });

  const profiles = userId
    ? [db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(userId)].filter(Boolean)
    : db.prepare("SELECT * FROM pay_profiles").all();

  if (profiles.length === 0) return res.status(400).json({ error: "No matching pay profile(s) found" });
  if (shouldSend && !isEmailConfigured()) {
    return res.status(503).json({ error: "Email isn't configured yet. Add GMAIL_USER and GMAIL_APP_PASSWORD to backend/.env to send payslips." });
  }

  const payDate = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const profile of profiles) {
    const slip = await generateOneSlip({ profile, period, payDate, adminUserId: req.user.userId, sendNow: !!shouldSend });
    results.push(slip);
  }
  res.status(201).json(results);
});

// GET /api/payroll — own payslips, or all with payroll:view_all
router.get("/", requireAuth, (req, res) => {
  const granted = db
    .prepare(`SELECT p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
    .all(req.user.roleId).map((r) => r.action);

  const rows = granted.includes("payroll:view_all")
    ? db.prepare(`SELECT ps.*, u.name AS user_name, c.name AS company_name FROM payslips ps JOIN users u ON u.id = ps.user_id JOIN companies c ON c.id = ps.company_id ORDER BY ps.pay_period DESC`).all()
    : db.prepare(`SELECT ps.*, c.name AS company_name FROM payslips ps JOIN companies c ON c.id = ps.company_id WHERE ps.user_id = ? ORDER BY ps.pay_period DESC`).all(req.user.userId);
  res.json(rows);
});

// GET /api/payroll/:id/pdf — download, permission-checked (own slip or payroll:view_all)
router.get("/:id/pdf", requireAuth, (req, res) => {
  const slip = db.prepare("SELECT * FROM payslips WHERE id = ?").get(req.params.id);
  if (!slip) return res.status(404).json({ error: "Payslip not found" });
  if (slip.user_id !== req.user.userId) {
    const granted = db
      .prepare(`SELECT p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
      .all(req.user.roleId).map((r) => r.action);
    if (!granted.includes("payroll:view_all")) return res.status(403).json({ error: "Not authorized" });
  }
  if (!slip.pdf_path || !fs.existsSync(slip.pdf_path)) return res.status(404).json({ error: "PDF not found on disk" });
  res.download(slip.pdf_path);
});

export default router;
