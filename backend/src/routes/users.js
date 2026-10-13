import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth, requirePermission, clearPermissionCache } from "../middleware/auth.js";
import { adminGrantError, isOwnerName } from "../access.js";

const router = Router();

// GET /api/users — assignable roster (for login screen + assign-task dropdown).
// Deliberately excludes phone numbers and any sensitive fields from this public view;
// phone is only exposed to callers with staff:manage permission (see /api/users/full below).
router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, d.name AS department, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.active = 1 AND (r.name != 'admin' OR u.password_hash IS NULL)
       ORDER BY d.name, u.name`
    )
    .all();
  res.json(rows);
});

// GET /api/users/full — admin/manager view including phone, for the dashboard.
router.get("/full", requireAuth, requirePermission("task:view_all"), (req, res) => {
  backfillEmployeeCodes();
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.phone, u.email, u.birthday, u.joined_at, u.designation, u.shift_role, u.active, u.employee_code, u.employment_type, u.reporting_to, u.emergency_contact_name, u.emergency_contact_phone, u.alt_phone, (u.photo_path IS NOT NULL) AS has_photo, u.address, u.blood_group, u.gender, d.name AS department, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${req.query.includeInactive ? "" : "WHERE u.active = 1"}
       ORDER BY u.active DESC, d.name, u.name`
    )
    .all();
  res.json(rows);
});

// GET /api/users/shift-roles — every shift-checklist role template name, for the
// Staff admin screen's "assign a shift checklist" dropdown.
router.get("/shift-roles", requireAuth, requirePermission("task:view_all"), (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT role_name FROM shift_checklist_templates ORDER BY role_name`).all();
  res.json(rows.map((r) => r.role_name));
});

// ---- Onboarding helpers -------------------------------------------------
const EXTRA_FIELDS = {
  employeeCode: "employee_code", employmentType: "employment_type", reportingTo: "reporting_to",
  gender: "gender", bloodGroup: "blood_group", address: "address",
  emergencyContactName: "emergency_contact_name", emergencyContactPhone: "emergency_contact_phone", altPhone: "alt_phone",
};
export const DOC_CHECKLIST = [
  { key: "id_proof", label: "Government ID (Aadhaar / PAN)" },
  { key: "address_proof", label: "Address proof" },
  { key: "photo", label: "Passport-size photo" },
  { key: "education", label: "Education certificates" },
  { key: "experience", label: "Previous experience letters" },
  { key: "bank", label: "Bank account details" },
  { key: "offer_signed", label: "Signed offer / appointment letter" },
  { key: "policies_signed", label: "Clinic policies & confidentiality signed" },
];

function nextEmployeeCode() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE employee_code IS NOT NULL").get().n;
  let i = n + 1, code;
  do { code = `DNC-${String(i++).padStart(3, "0")}`; } while (db.prepare("SELECT 1 FROM users WHERE employee_code = ?").get(code));
  return code;
}
// Gives anyone without an employee code one (runs lazily, so it also covers people created by the seed script).
function backfillEmployeeCodes() {
  for (const row of db.prepare("SELECT id FROM users WHERE employee_code IS NULL ORDER BY created_at, name").all()) {
    db.prepare("UPDATE users SET employee_code = ? WHERE id = ?").run(nextEmployeeCode(), row.id);
  }
}

function applyExtras(userId, body) {
  for (const [key, col] of Object.entries(EXTRA_FIELDS)) {
    if (body[key] !== undefined) db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(body[key] || null, userId);
  }
}

// POST /api/users — onboard a new team member (requires staff:manage)
router.post("/", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { name, departmentName, roleName, phone, pin, email, birthday, joinedAt, designation, shiftRole } = req.body || {};
  if (!name || !departmentName || !roleName || !phone || !pin) {
    return res.status(400).json({ error: "name, departmentName, roleName, phone, pin are required" });
  }
  if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be exactly 4 digits" });
  if (db.prepare("SELECT 1 FROM users WHERE phone = ?").get(phone)) return res.status(409).json({ error: "A staff member with this phone number already exists" });
  if (email && db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "A staff member with this email already exists" });
  const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!role) return res.status(400).json({ error: `Unknown role: ${roleName}` });
  if (roleName === "admin" && !isOwnerName(name)) return res.status(403).json({ error: "Admin access is only for Dr. Nishita, Shreyas, Naga and Neelima." });
  let dept = db.prepare("SELECT id FROM departments WHERE name = ?").get(departmentName);
  if (!dept) {
    const id = randomUUID();
    db.prepare("INSERT INTO departments (id, name) VALUES (?, ?)").run(id, departmentName);
    dept = { id };
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, name, phone, email, pin_hash, role_id, department_id, birthday, joined_at, designation, shift_role, employee_code, must_change_pin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, name, phone, email || null, bcrypt.hashSync(String(pin), 10), role.id, dept.id,
        birthday || null, joinedAt || null, designation || null, shiftRole || null, req.body.employeeCode || nextEmployeeCode());
  applyExtras(id, req.body);
  res.status(201).json({ id, name, department: departmentName, role: roleName });
});

// GET /api/users/onboarding — every active person with a completeness score.
router.get("/onboarding", requireAuth, requirePermission("task:view_all"), (req, res) => {
  backfillEmployeeCodes();
  const rows = db.prepare(
    `SELECT u.*, d.name AS department, r.name AS role FROM users u
     JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.active = 1 ORDER BY d.name, u.name`
  ).all();
  const people = rows.map((u) => {
    const docs = u.onboarding_docs ? JSON.parse(u.onboarding_docs) : {};
    const checks = [
      ["Email", !!u.email], ["Real phone number", !!u.phone && !u.phone.startsWith("+9190000200")],
      ["Date of birth", !!u.birthday], ["Joining date", !!u.joined_at],
      ["Designation", !!u.designation && !u.designation.includes("confirm")],
      ["Employment type", !!u.employment_type], ["Reporting manager", !!u.reporting_to],
      ["Blood group", !!u.blood_group], ["Home address", !!u.address],
      ["Emergency contact", !!u.emergency_contact_name && !!u.emergency_contact_phone],
      ...(u.role === "admin" ? [] : [["Shift checklist role", !!u.shift_role]]),
      ...DOC_CHECKLIST.map((d) => [d.label, !!docs[d.key]]),
    ];
    const done = checks.filter((c) => c[1]).length;
    const pct = Math.round((done / checks.length) * 100);
    return {
      id: u.id, name: u.name, department: u.department, role: u.role, designation: u.designation,
      employeeCode: u.employee_code, joinedAt: u.joined_at, mustChangePin: !!u.must_change_pin,
      docs, pct, missing: checks.filter((c) => !c[1]).map((c) => c[0]),
      status: pct === 100 ? "complete" : pct >= 50 ? "in_progress" : "not_started",
    };
  });
  res.json({ docChecklist: DOC_CHECKLIST, people });
});

// PATCH /api/users/:id/onboarding-docs  { docs: { id_proof: true, ... } }
router.patch("/:id/onboarding-docs", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const u = db.prepare("SELECT onboarding_docs FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  const merged = { ...(u.onboarding_docs ? JSON.parse(u.onboarding_docs) : {}), ...(req.body?.docs || {}) };
  db.prepare("UPDATE users SET onboarding_docs = ? WHERE id = ?").run(JSON.stringify(merged), req.params.id);
  res.json({ ok: true, docs: merged });
});

// POST /api/users/me/pin  { currentPin, newPin } — staff change their own PIN
router.post("/me/pin", requireAuth, (req, res) => {
  const { currentPin, newPin } = req.body || {};
  const u = db.prepare("SELECT pin_hash FROM users WHERE id = ?").get(req.user.userId);
  if (!u?.pin_hash || !bcrypt.compareSync(String(currentPin || ""), u.pin_hash)) return res.status(401).json({ error: "Current PIN is incorrect" });
  if (!/^\d{4}$/.test(String(newPin || ""))) return res.status(400).json({ error: "New PIN must be exactly 4 digits" });
  if (String(newPin) === "1234") return res.status(400).json({ error: "Please choose a PIN other than 1234" });
  db.prepare("UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?").run(bcrypt.hashSync(String(newPin), 10), req.user.userId);
  res.json({ ok: true });
});

// POST /api/users/:id/reset-pin  { newPin } — admin resets a forgotten PIN (person must change it at next sign-in)
router.post("/:id/reset-pin", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { newPin } = req.body || {};
  if (!/^\d{4}$/.test(String(newPin || ""))) return res.status(400).json({ error: "PIN must be exactly 4 digits" });
  db.prepare("UPDATE users SET pin_hash = ?, must_change_pin = 1 WHERE id = ?").run(bcrypt.hashSync(String(newPin), 10), req.params.id);
  res.json({ ok: true });
});

// PATCH /api/users/:id/deactivate -- "remove" a person: they can no longer sign in, but their history stays intact.
router.patch("/:id/deactivate", requireAuth, requirePermission("staff:manage"), (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: "You cannot remove your own account." });
  const target = db.prepare("SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "admin" && db.prepare("SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.active = 1").get().n <= 1) {
    return res.status(400).json({ error: "This is the only active admin and cannot be removed." });
  }
  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.patch("/:id/reactivate", requireAuth, requirePermission("staff:manage"), (req, res) => {
  db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// PATCH /api/users/:id/role — change a user's role (requires staff:manage)
router.patch("/:id/role", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { roleName } = req.body || {};
  const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!role) return res.status(400).json({ error: `Unknown role: ${roleName}` });
  { const g = adminGrantError(roleName, req.params.id); if (g) return res.status(403).json({ error: g }); }
  db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(role.id, req.params.id);
  clearPermissionCache(); // no-op today since cache is per-role not per-user, kept for future per-user overrides
  res.json({ ok: true });
});

// PATCH /api/users/:id — update birthday/joined_at (and other basic fields) for an existing user
router.patch("/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { birthday, joinedAt, phone, name, email, designation, shiftRole, departmentName, roleName } = req.body || {};
  if (phone && db.prepare("SELECT 1 FROM users WHERE phone = ? AND id != ?").get(phone, req.params.id)) return res.status(409).json({ error: "Another staff member already uses this phone number" });
  if (email && db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, req.params.id)) return res.status(409).json({ error: "Another staff member already uses this email" });
  if (departmentName) {
    let dept = db.prepare("SELECT id FROM departments WHERE name = ?").get(departmentName);
    if (!dept) { const id = randomUUID(); db.prepare("INSERT INTO departments (id, name) VALUES (?, ?)").run(id, departmentName); dept = { id }; }
    db.prepare("UPDATE users SET department_id = ? WHERE id = ?").run(dept.id, req.params.id);
  }
  if (roleName) {
    const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName);
    if (!role) return res.status(400).json({ error: `Unknown role: ${roleName}` });
    if (req.params.id === req.user.userId && roleName !== "admin") return res.status(400).json({ error: "You cannot lower your own access." });
    { const g = adminGrantError(roleName, req.params.id); if (g) return res.status(403).json({ error: g }); }
    db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(role.id, req.params.id);
  }
  db.prepare(
    `UPDATE users SET
       birthday = COALESCE(?, birthday),
       joined_at = COALESCE(?, joined_at),
       phone = COALESCE(?, phone),
       name = COALESCE(?, name),
       email = COALESCE(?, email),
       designation = COALESCE(?, designation)
     WHERE id = ?`
  ).run(birthday ?? null, joinedAt ?? null, phone ?? null, name ?? null, email ?? null, designation ?? null, req.params.id);
  // shiftRole is handled separately so it can be explicitly CLEARED (empty
  // string -> NULL, "no shift checklist"), unlike the COALESCE fields above
  // where omitting a field means "leave unchanged".
  if (shiftRole !== undefined) {
    db.prepare("UPDATE users SET shift_role = ? WHERE id = ?").run(shiftRole || null, req.params.id);
  }
  applyExtras(req.params.id, req.body || {});
  res.json({ ok: true });
});

function roleHas(roleId, action) {
  return !!db
    .prepare(`SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? AND p.action = ?`)
    .get(roleId, action);
}

// GET /api/users/:id/profile  (":id" may be "me")
// One call that gathers everything the dashboards need about a single person.
// Allowed for the person themselves, or anyone with task:view_all (admin/manager).
// The payroll block is only included for the person themselves or payroll:view_all.
router.get("/:id/profile", requireAuth, (req, res) => {
  backfillEmployeeCodes();
  const id = req.params.id === "me" ? req.user.userId : req.params.id;
  const isSelf = id === req.user.userId;
  if (!isSelf && !roleHas(req.user.roleId, "task:view_all")) {
    return res.status(403).json({ error: "Missing permission: task:view_all" });
  }

  const u = db.prepare(
    `SELECT u.id, u.name, u.phone, u.email, u.birthday, u.joined_at, u.designation, u.shift_role, u.active,
            u.employee_code, u.employment_type, u.reporting_to, u.gender, u.blood_group, u.address, u.emergency_contact_name, u.emergency_contact_phone, u.alt_phone, (u.photo_path IS NOT NULL) AS has_photo,
            d.name AS department, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = ?`
  ).get(id);
  if (!u) return res.status(404).json({ error: "User not found" });

  // --- tenure ---
  const tenureYears = u.joined_at
    ? Number(((Date.now() - new Date(u.joined_at)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1))
    : null;

  // --- shift checklists: last 30 days ---
  const shiftRows = db.prepare(
    `SELECT work_date, shift, completed, total, completion_pct, photo_path, photo_ai_check, submitted_at
     FROM shift_checklist_submissions
     WHERE user_id = ? AND status = 'submitted' AND work_date >= date('now', '-30 days')
     ORDER BY work_date DESC, shift`
  ).all(id);
  const shiftAvg = shiftRows.length
    ? Math.round(shiftRows.reduce((s, r) => s + r.completion_pct, 0) / shiftRows.length)
    : null;
  const shiftChecklist = {
    roleName: u.shift_role,
    submissionsLast30: shiftRows.length,
    daysSubmittedLast30: new Set(shiftRows.map((r) => r.work_date)).size,
    avgCompletionPct: shiftAvg,
    withPhoto: shiftRows.filter((r) => r.photo_path).length,
    recent: shiftRows.slice(0, 14).map((r) => ({
      workDate: r.work_date, shift: r.shift, completed: r.completed, total: r.total,
      completionPct: r.completion_pct, hasPhoto: !!r.photo_path, submittedAt: r.submitted_at,
    })),
  };

  // --- tasks ---
  const taskRows = db.prepare(`SELECT status, due_date FROM tasks WHERE user_id = ?`).all(id);
  const nowIso = new Date().toISOString();
  const tasks = {
    total: taskRows.length,
    done: taskRows.filter((t) => t.status === "done").length,
    open: taskRows.filter((t) => t.status !== "done").length,
    overdue: taskRows.filter((t) => t.status !== "done" && t.due_date && t.due_date < nowIso).length,
  };
  tasks.completionRate = tasks.total ? Math.round((tasks.done / tasks.total) * 100) : null;
  tasks.recent = db.prepare(
    `SELECT title, category, status, due_date, updated_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 8`
  ).all(id);

  // --- attendance (last 30 days) ---
  const attRows = db.prepare(
    `SELECT type, recorded_at FROM attendance WHERE user_id = ? AND recorded_at >= datetime('now', '-30 days') ORDER BY recorded_at DESC`
  ).all(id);
  const attendance = {
    daysPresentLast30: new Set(attRows.filter((a) => a.type === "check_in").map((a) => a.recorded_at.slice(0, 10))).size,
    lastCheckIn: attRows.find((a) => a.type === "check_in")?.recorded_at || null,
    deviceRegistered: !!db.prepare(`SELECT 1 FROM webauthn_credentials WHERE user_id = ?`).get(id),
  };

  // --- policies ---
  const policiesTotal = db.prepare(`SELECT COUNT(*) AS n FROM policies`).get().n;
  const policiesAcked = db.prepare(
    `SELECT COUNT(*) AS n FROM policies p
     WHERE EXISTS (SELECT 1 FROM policy_acknowledgments a WHERE a.policy_id = p.id AND a.policy_version = p.version AND a.user_id = ?)`
  ).get(id).n;
  const policies = { total: policiesTotal, acknowledged: policiesAcked, pending: policiesTotal - policiesAcked };

  // --- training ---
  const trainingTotal = db.prepare(`SELECT COUNT(*) AS n FROM training_videos`).get().n;
  const trainingWatched = db.prepare(`SELECT COUNT(*) AS n FROM training_video_views WHERE user_id = ?`).get(id).n;
  const training = { total: trainingTotal, watched: trainingWatched };

  // --- bio from the About page, if they have one ---
  const bio = db.prepare(`SELECT title, bio FROM team_profiles WHERE name = ? OR name LIKE ?`).get(u.name, `%${u.name}%`) || null;

  // --- payroll status (restricted) ---
  let payroll = null;
  if (isSelf || roleHas(req.user.roleId, "payroll:view_all")) {
    const profile = db.prepare(
      `SELECT pp.employee_code, pp.position, pp.basic_salary, c.name AS company
       FROM pay_profiles pp JOIN companies c ON c.id = pp.company_id WHERE pp.user_id = ?`
    ).get(id);
    const slips = db.prepare(
      `SELECT pay_period, net_payable, emailed_at FROM payslips WHERE user_id = ? ORDER BY pay_period DESC LIMIT 6`
    ).all(id);
    payroll = { hasPayProfile: !!profile, profile: profile || null, recentPayslips: slips };
  }

  // --- data-completeness flags: what an admin still needs to fill in for this person ---
  const missing = [];
  if (!u.email) missing.push("email");
  if (!u.phone || u.phone.startsWith("+9190000200")) missing.push("real phone number");
  if (!u.birthday) missing.push("birthday");
  if (!u.joined_at) missing.push("join date");
  if (!u.designation || u.designation.includes("confirm")) missing.push("confirmed designation");
  const full = db.prepare("SELECT employment_type, reporting_to, blood_group, address, emergency_contact_name, emergency_contact_phone, employee_code FROM users WHERE id = ?").get(id);
  if (!full.employment_type) missing.push("employment type");
  if (!full.reporting_to) missing.push("reporting manager");
  if (!full.blood_group) missing.push("blood group");
  if (!full.address) missing.push("home address");
  if (!full.emergency_contact_name || !full.emergency_contact_phone) missing.push("emergency contact");

  res.json({
    details: { ...u, tenureYears },
    bio, missing, shiftChecklist, tasks, attendance, policies, training, payroll,
  });
});


// ---- profile pictures ---------------------------------------------------------
const PHOTO_DIR = path.join(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "private", "photos");
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)) });
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

router.post("/:id/photo", requireAuth, requirePermission("staff:manage"), photoUpload.single("photo"), (req, res) => {
  const u = db.prepare("SELECT id, photo_path FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  if (!req.file) return res.status(400).json({ error: "Choose a JPG, PNG or WebP picture (up to 4 MB)" });
  const file = path.join(PHOTO_DIR, `${u.id}-${Date.now()}${EXT[req.file.mimetype]}`);
  fs.writeFileSync(file, req.file.buffer);
  if (u.photo_path) fs.rm(u.photo_path, { force: true }, () => {});
  db.prepare("UPDATE users SET photo_path = ? WHERE id = ?").run(file, u.id);
  res.json({ ok: true });
});
router.delete("/:id/photo", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const u = db.prepare("SELECT photo_path FROM users WHERE id = ?").get(req.params.id);
  if (u?.photo_path) fs.rm(u.photo_path, { force: true }, () => {});
  db.prepare("UPDATE users SET photo_path = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
// <img> tags cannot send headers, so the sign-in token may come as ?token=
router.get("/:id/photo", (req, res, next) => { if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`; next(); }, requireAuth, (req, res) => {
  const u = db.prepare("SELECT photo_path FROM users WHERE id = ?").get(req.params.id === "me" ? req.user.userId : req.params.id);
  if (!u?.photo_path || !fs.existsSync(u.photo_path)) return res.status(404).json({ error: "No photo" });
  res.set("Cache-Control", "private, max-age=300"); res.sendFile(u.photo_path);
});

export default router;
