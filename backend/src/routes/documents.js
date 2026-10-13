// Documents hub (department folders), uploadable Word templates (offer letters,
// payslips) and bulk generation from them. Files live in a PRIVATE folder and
// are only ever served through authenticated routes below.
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import db from "../db.js";
import { withFines } from "./fines.js";
import { requireAuth } from "../middleware/auth.js";
import { DOC_CHECKLIST } from "./users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(__dirname, "..", "..");
const PRIVATE = path.join(DATA, "private");
const DOC_DIR = path.join(PRIVATE, "documents");
const TPL_DIR = path.join(PRIVATE, "templates");
const GEN_DIR = path.join(PRIVATE, "generated");
for (const d of [DOC_DIR, TPL_DIR, GEN_DIR]) fs.mkdirSync(d, { recursive: true });

const isAdmin = (req) => req.user?.roleName === "admin";
const isLead = (req) => ["admin", "manager"].includes(req.user?.roleName);
const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: "Admin only" }));

const storage = (dir) =>
  multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname || "").toLowerCase()}`),
  });
const fixName = (n) => { try { return Buffer.from(n, "latin1").toString("utf8"); } catch { return n; } };

// ===========================================================================
// DOCUMENTS HUB
// ===========================================================================
export const documentsRouter = Router();
const docUpload = multer({ storage: storage(DOC_DIR), limits: { fileSize: 50 * 1024 * 1024 } });

function myDeptId(req) {
  return db.prepare("SELECT department_id FROM users WHERE id = ?").get(req.user.userId)?.department_id || null;
}

const DOC_SELECT = `SELECT d.id, d.title, d.category, d.kind, d.url, d.file_name, d.mime, d.size, d.note, d.created_at,
    d.department_id, dep.name AS department, d.uploaded_by, u.name AS uploaded_by_name
  FROM documents d LEFT JOIN departments dep ON dep.id = d.department_id LEFT JOIN users u ON u.id = d.uploaded_by`;

documentsRouter.get("/", requireAuth, (req, res) => {
  let rows;
  if (isLead(req)) rows = db.prepare(`${DOC_SELECT} WHERE d.staff_user_id IS NULL ORDER BY d.created_at DESC`).all();
  else rows = db.prepare(`${DOC_SELECT} WHERE d.staff_user_id IS NULL AND (d.department_id IS ? OR d.uploaded_by = ?) ORDER BY d.created_at DESC`).all(myDeptId(req), req.user.userId);
  const departments = db.prepare("SELECT id, name FROM departments ORDER BY name").all();
  res.json({ documents: rows, departments, myDepartmentId: myDeptId(req), canSeeAll: isLead(req) });
});

documentsRouter.post("/", requireAuth, docUpload.single("file"), (req, res) => {
  const { title, category, note, url } = req.body || {};
  let departmentId = req.body?.departmentId || null;
  if (!isAdmin(req)) departmentId = myDeptId(req); // staff/managers always file under their own department
  const kind = req.file ? "file" : "link";
  if (kind === "link" && !/^https?:\/\//i.test(url || "")) return res.status(400).json({ error: "Attach a file, or paste a link that starts with https://" });
  const name = (title || (req.file ? fixName(req.file.originalname) : "") || "").trim();
  if (!name) return res.status(400).json({ error: "Please give the document a title" });
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, department_id, title, category, kind, url, file_path, file_name, mime, size, note, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, departmentId, name, category || "Document", kind, kind === "link" ? url : null,
    req.file?.path || null, req.file ? fixName(req.file.originalname) : null, req.file?.mimetype || null, req.file?.size || null,
    note || null, req.user.userId);
  res.status(201).json({ id });
});

function canAccessDoc(req, d) {
  if (d.staff_user_id) return isAdmin(req) || d.staff_user_id === req.user.userId; // personal HR files: admin + the person only
  return isLead(req) || d.uploaded_by === req.user.userId || (d.department_id && d.department_id === myDeptId(req));
}

// ---- Personal staff files (ID proof, certificates, bank details ...) ----
documentsRouter.get("/staff/:userId", requireAuth, (req, res) => {
  const uid = req.params.userId === "me" ? req.user.userId : req.params.userId;
  if (!isAdmin(req) && uid !== req.user.userId) return res.status(403).json({ error: "Not allowed" });
  const files = db.prepare(
    `SELECT d.id, d.doc_type, d.title, d.file_name, d.size, d.created_at, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.staff_user_id = ? ORDER BY d.created_at DESC`).all(uid);
  res.json({ types: DOC_CHECKLIST, files, canManage: isAdmin(req) });
});

documentsRouter.post("/staff/:userId", requireAuth, adminOnly, docUpload.single("file"), (req, res) => {
  const user = db.prepare("SELECT id, department_id, onboarding_docs FROM users WHERE id = ?").get(req.params.userId);
  if (!user) return res.status(404).json({ error: "Staff member not found" });
  if (!req.file) return res.status(400).json({ error: "Choose a file" });
  const type = DOC_CHECKLIST.find((t) => t.key === req.body?.docType);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, department_id, title, category, kind, file_path, file_name, mime, size, uploaded_by, staff_user_id, doc_type)
     VALUES (?, ?, ?, 'Staff file', 'file', ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user.department_id, type?.label || fixName(req.file.originalname), req.file.path, fixName(req.file.originalname), req.file.mimetype, req.file.size, req.user.userId, user.id, type?.key || null);
  if (type) { // uploading the paper marks it as collected in the onboarding checklist
    const merged = { ...(user.onboarding_docs ? JSON.parse(user.onboarding_docs) : {}), [type.key]: true };
    db.prepare("UPDATE users SET onboarding_docs = ? WHERE id = ?").run(JSON.stringify(merged), user.id);
  }
  res.status(201).json({ id });
});

documentsRouter.get("/:id/file", requireAuth, (req, res) => {
  const d = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!d || !d.file_path || !fs.existsSync(d.file_path)) return res.status(404).json({ error: "File not found" });
  if (!canAccessDoc(req, d)) return res.status(403).json({ error: "Not allowed" });
  res.download(d.file_path, d.file_name || "document");
});

documentsRouter.delete("/:id", requireAuth, (req, res) => {
  const d = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  if (!isAdmin(req) && d.uploaded_by !== req.user.userId) return res.status(403).json({ error: "Only the uploader or admin can delete this" });
  if (d.file_path) fs.rm(d.file_path, { force: true }, () => {});
  db.prepare("DELETE FROM documents WHERE id = ?").run(d.id);
  if (d.staff_user_id && d.doc_type && !db.prepare("SELECT 1 FROM documents WHERE staff_user_id = ? AND doc_type = ?").get(d.staff_user_id, d.doc_type)) {
    const u = db.prepare("SELECT onboarding_docs FROM users WHERE id = ?").get(d.staff_user_id);
    const merged = { ...(u?.onboarding_docs ? JSON.parse(u.onboarding_docs) : {}), [d.doc_type]: false };
    db.prepare("UPDATE users SET onboarding_docs = ? WHERE id = ?").run(JSON.stringify(merged), d.staff_user_id);
  }
  res.json({ ok: true });
});

// ===========================================================================
// WORD TEMPLATES + BULK GENERATION
// ===========================================================================
export const templatesRouter = Router();
const tplUpload = multer({
  storage: storage(TPL_DIR),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.docx$/i.test(file.originalname || "")),
});

export const FIELDS = {
  offer_letter: [
    ["name", "Staff full name"], ["first_name", "First name"], ["role", "Designation / role"], ["department", "Department"],
    ["employee_code", "Employee code"], ["joining_date", "Joining date"], ["salary", "Monthly salary (basic)"],
    ["company", "Company name"], ["company_address", "Company address"], ["date", "Today's date"], ["phone", "Phone"], ["email", "Email"],
  ],
  payslip: [
    ["name", "Staff full name"], ["employee_code", "Employee code"], ["role", "Position"], ["department", "Department"],
    ["company", "Company name"], ["company_address", "Company address"], ["period", "Pay period (e.g. October 2026)"], ["pay_date", "Pay date"],
    ["pan", "PAN"], ["basic", "Basic salary"], ["leave_bonus", "Leave bonus"], ["overtime", "Overtime"], ["other_allowances", "Other allowances"],
    ["gross", "Total earnings"], ["pf", "PF"], ["tds", "TDS"], ["other_deductions", "Other deductions (includes fines)"], ["fines", "Fines this month"], ["retention", "Retention"],
    ["total_deductions", "Total deductions"], ["net", "Net payable"], ["joining_date", "Joining date"],
  ],
};

const money = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const longDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");

function valuesFor(kind, user, profile0, company, period, extra = {}) {
  const profile = kind === "payslip" && profile0 ? withFines(profile0, period) : profile0;
  const base = {
    name: user.name, first_name: (user.name || "").split(" ")[0], role: profile?.position || user.designation || user.role_name || "",
    department: user.department || "", employee_code: profile?.employee_code || user.employee_code || "",
    joining_date: longDate(user.joined_at), company: company?.name || "", company_address: company?.address || "",
    date: longDate(new Date()), phone: user.phone || "", email: user.email || "",
    salary: money(profile?.basic_salary),
  };
  if (kind === "payslip") {
    const gross = (profile?.basic_salary || 0) + (profile?.leave_bonus || 0) + (profile?.overtime || 0) + (profile?.other_allowances || 0);
    const ded = (profile?.pf || 0) + (profile?.tds || 0) + (profile?.other_deductions || 0) + (profile?.retention || 0);
    const [y, m] = (period || "").split("-");
    Object.assign(base, {
      period: y && m ? new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : period || "",
      pay_date: longDate(extra.payDate || new Date()), pan: profile?.pan || "",
      basic: money(profile?.basic_salary), leave_bonus: money(profile?.leave_bonus), overtime: money(profile?.overtime),
      other_allowances: money(profile?.other_allowances), gross: money(gross), pf: money(profile?.pf), tds: money(profile?.tds),
      other_deductions: money(profile?.other_deductions), retention: money(profile?.retention),
      total_deductions: money(ded), fines: money(profile?.fines), net: money(gross - ded),
    });
  }
  return { ...base, ...extra.fields };
}

function render(templatePath, values) {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(values);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// Builds a tiny valid .docx from plain paragraphs (used for the downloadable sample templates).
function buildDocx(paragraphs) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs
    .map((p) => `<w:p><w:r>${p.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`)
    .join("");
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

const SAMPLES = {
  offer_letter: [
    { text: "{company}", bold: true }, { text: "{company_address}" }, { text: "" }, { text: "Date: {date}" }, { text: "" },
    { text: "Dear {name}," }, { text: "" },
    { text: "We are pleased to offer you the position of {role} in the {department} department, with effect from {joining_date}. Your employee code is {employee_code}." },
    { text: "Your monthly salary will be Rs. {salary}." }, { text: "" },
    { text: "Please sign and return a copy of this letter to confirm your acceptance." }, { text: "" },
    { text: "Dr. Nishita Ranka", bold: true }, { text: "Founder & Medical Director" },
  ],
  payslip: [
    { text: "{company}", bold: true }, { text: "{company_address}" }, { text: "" },
    { text: "PAYSLIP - {period}", bold: true }, { text: "Employee: {name}  ({employee_code})" }, { text: "Position: {role}    PAN: {pan}" }, { text: "" },
    { text: "Basic: {basic}" }, { text: "Leave bonus: {leave_bonus}" }, { text: "Overtime: {overtime}" }, { text: "Other allowances: {other_allowances}" },
    { text: "Total earnings: {gross}", bold: true }, { text: "" },
    { text: "PF: {pf}" }, { text: "TDS: {tds}" }, { text: "Other deductions: {other_deductions}" }, { text: "of which fines: {fines}" }, { text: "Retention: {retention}" },
    { text: "Total deductions: {total_deductions}", bold: true }, { text: "" },
    { text: "NET PAYABLE: Rs. {net}", bold: true }, { text: "Paid on {pay_date}" },
  ],
};

templatesRouter.get("/fields", requireAuth, adminOnly, (req, res) => {
  res.json(Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, v.map(([key, label]) => ({ key, label }))])));
});

templatesRouter.get("/sample/:kind", requireAuth, adminOnly, (req, res) => {
  const s = SAMPLES[req.params.kind];
  if (!s) return res.status(404).json({ error: "Unknown template type" });
  res.setHeader("Content-Disposition", `attachment; filename="sample-${req.params.kind}-template.docx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.send(buildDocx(s));
});

templatesRouter.get("/", requireAuth, adminOnly, (req, res) => {
  const { kind } = req.query;
  const rows = db.prepare(
    `SELECT t.id, t.kind, t.name, t.company_id, c.name AS company, t.file_name, t.created_at
     FROM doc_templates t LEFT JOIN companies c ON c.id = t.company_id
     ${kind ? "WHERE t.kind = ?" : ""} ORDER BY t.created_at DESC`
  ).all(...(kind ? [kind] : []));
  res.json(rows);
});

templatesRouter.post("/", requireAuth, adminOnly, tplUpload.single("file"), (req, res) => {
  const { kind, name, companyId } = req.body || {};
  if (!FIELDS[kind]) return res.status(400).json({ error: "Choose offer letter or payslip" });
  if (!req.file) return res.status(400).json({ error: "Please upload a Word (.docx) file" });
  // Make sure it opens as a Word document and the {placeholders} are well-formed before we save it.
  try { render(req.file.path, valuesFor(kind, { name: "Test" }, null, null, "2026-01")); }
  catch (e) {
    fs.rm(req.file.path, { force: true }, () => {});
    const detail = e?.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean)[0];
    return res.status(400).json({ error: `This Word file has a problem with its {placeholders}. ${detail || "Check every { has a matching }."}` });
  }
  const id = randomUUID();
  db.prepare("INSERT INTO doc_templates (id, kind, name, company_id, file_path, file_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, kind, (name || fixName(req.file.originalname)).trim(), companyId || null, req.file.path, fixName(req.file.originalname), req.user.userId);
  res.status(201).json({ id });
});

templatesRouter.get("/:id/file", requireAuth, adminOnly, (req, res) => {
  const t = db.prepare("SELECT * FROM doc_templates WHERE id = ?").get(req.params.id);
  if (!t || !fs.existsSync(t.file_path)) return res.status(404).json({ error: "Not found" });
  res.download(t.file_path, t.file_name || "template.docx");
});

templatesRouter.delete("/:id", requireAuth, adminOnly, (req, res) => {
  const t = db.prepare("SELECT * FROM doc_templates WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Not found" });
  db.prepare("UPDATE generated_docs SET template_id = NULL WHERE template_id = ?").run(t.id);
  db.prepare("DELETE FROM doc_templates WHERE id = ?").run(t.id);
  fs.rm(t.file_path, { force: true }, () => {});
  res.json({ ok: true });
});

const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_");

// POST /api/doc-templates/generate  { templateId, userIds?: [] (omit = everyone who fits), period?: 'YYYY-MM' }
templatesRouter.post("/generate", requireAuth, adminOnly, (req, res) => {
  const { templateId, userIds, period } = req.body || {};
  const t = db.prepare("SELECT * FROM doc_templates WHERE id = ?").get(templateId);
  if (!t) return res.status(404).json({ error: "Template not found" });
  if (t.kind === "payslip" && !/^\d{4}-\d{2}$/.test(period || "")) return res.status(400).json({ error: "Choose the pay month" });

  const base = `SELECT u.*, d.name AS department, r.name AS role_name FROM users u
                LEFT JOIN departments d ON d.id = u.department_id JOIN roles r ON r.id = u.role_id WHERE u.active = 1`;
  let users = db.prepare(base).all();
  if (Array.isArray(userIds) && userIds.length) users = users.filter((u) => userIds.includes(u.id));
  const results = [], skipped = [];
  for (const u of users) {
    const profile = db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(u.id);
    // Company: the template's company wins; otherwise the person's own pay-profile company.
    const companyId = t.company_id || profile?.company_id || null;
    const company = companyId ? db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) : null;
    if (t.kind === "payslip") {
      if (!profile) { skipped.push({ name: u.name, reason: "No salary details yet" }); continue; }
      if (t.company_id && profile.company_id !== t.company_id) continue; // belongs to another company's template
    }
    try {
      const buf = render(t.file_path, valuesFor(t.kind, u, profile, company, period));
      const id = randomUUID();
      const fname = t.kind === "payslip" ? `Payslip_${period}_${safe(u.name)}.docx` : `OfferLetter_${safe(u.name)}.docx`;
      const fpath = path.join(GEN_DIR, `${id}.docx`);
      fs.writeFileSync(fpath, buf);
      db.prepare("INSERT INTO generated_docs (id, template_id, kind, user_id, company_id, period, file_path, file_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, t.id, t.kind, u.id, companyId, period || null, fpath, fname, req.user.userId);
      results.push({ id, name: u.name, file_name: fname });
    } catch (e) {
      skipped.push({ name: u.name, reason: "Could not fill the template" });
    }
  }
  res.status(201).json({ generated: results, skipped });
});

templatesRouter.get("/generated", requireAuth, adminOnly, (req, res) => {
  const { kind } = req.query;
  res.json(db.prepare(
    `SELECT g.id, g.kind, g.period, g.file_name, g.created_at, u.name AS user_name, c.name AS company
     FROM generated_docs g LEFT JOIN users u ON u.id = g.user_id LEFT JOIN companies c ON c.id = g.company_id
     ${kind ? "WHERE g.kind = ?" : ""} ORDER BY g.created_at DESC LIMIT 300`).all(...(kind ? [kind] : [])));
});

templatesRouter.get("/generated/:id/file", requireAuth, adminOnly, (req, res) => {
  const g = db.prepare("SELECT * FROM generated_docs WHERE id = ?").get(req.params.id);
  if (!g || !fs.existsSync(g.file_path)) return res.status(404).json({ error: "Not found" });
  res.download(g.file_path, g.file_name);
});

templatesRouter.post("/generated/zip", requireAuth, adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: "Nothing selected" });
  const zip = new PizZip();
  for (const id of ids) {
    const g = db.prepare("SELECT * FROM generated_docs WHERE id = ?").get(id);
    if (g && fs.existsSync(g.file_path)) zip.file(g.file_name, fs.readFileSync(g.file_path));
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="documents.zip"');
  res.send(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
});

templatesRouter.delete("/generated/:id", requireAuth, adminOnly, (req, res) => {
  const g = db.prepare("SELECT * FROM generated_docs WHERE id = ?").get(req.params.id);
  if (g) { fs.rm(g.file_path, { force: true }, () => {}); db.prepare("DELETE FROM generated_docs WHERE id = ?").run(g.id); }
  res.json({ ok: true });
});

// ===========================================================================
// CONNECTED TOOLS (clinic assistant chatbot, dashboards): admin-editable links
// ===========================================================================
export const linksRouter = Router();
linksRouter.get("/", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT key, title, url, audience FROM app_links ORDER BY key").all();
  res.json(rows.filter((r) => r.audience === "all" || isLead(req)));
});
// Server-side test: can this computer reach the tool, and does the tool allow being shown inside the app?
linksRouter.get("/:key/check", requireAuth, async (req, res) => {
  const row = db.prepare("SELECT * FROM app_links WHERE key = ?").get(req.params.key);
  if (!row || (row.audience === "lead" && !isLead(req))) return res.status(404).json({ error: "Unknown tool" });
  try {
    const r = await fetch(row.url, { redirect: "follow", signal: AbortSignal.timeout(6000) });
    const xfo = (r.headers.get("x-frame-options") || "").toLowerCase();
    const csp = (r.headers.get("content-security-policy") || "").toLowerCase();
    const blocksFrame = xfo.includes("deny") || xfo.includes("sameorigin") || /frame-ancestors\s+('none'|'self')/.test(csp);
    res.json({ reachable: true, status: r.status, canEmbed: !blocksFrame });
  } catch (e) {
    res.json({ reachable: false, canEmbed: false, reason: e.name === "TimeoutError" ? "No answer within 6 seconds" : (e.cause?.code || e.message) });
  }
});
linksRouter.put("/:key", requireAuth, adminOnly, (req, res) => {
  const { url, title } = req.body || {};
  if (!/^https?:\/\//i.test(url || "")) return res.status(400).json({ error: "The address must start with http:// or https://" });
  const cur = db.prepare("SELECT * FROM app_links WHERE key = ?").get(req.params.key);
  if (!cur) return res.status(404).json({ error: "Unknown tool" });
  db.prepare("UPDATE app_links SET url = ?, title = ?, updated_at = datetime('now') WHERE key = ?").run(url.trim(), (title || cur.title).trim(), cur.key);
  res.json({ ok: true });
});
