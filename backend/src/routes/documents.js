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
import { inWords } from "../words.js";
import { requireAuth } from "../middleware/auth.js";
import { DOC_CHECKLIST } from "./users.js";
import { sendEmail, isEmailConfigured, friendlyMailError } from "../email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(__dirname, "..", "..");
const PRIVATE = path.join(DATA, "private");
const DOC_DIR = path.join(PRIVATE, "documents");
const TPL_DIR = path.join(PRIVATE, "templates");
export const GEN_DIR = path.join(PRIVATE, "generated");
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
    ["letter_date", "Letter date"], ["address", "Candidate address"], ["gross_salary", "Gross salary per month"], ["net_salary", "Net monthly salary"],
    ["retention_bonus", "Retention bonus per month"], ["payout_day", "Salary payout day"], ["probation", "Probation period"], ["duties", "Job responsibilities (use {#duties}{.}{/duties} on its own line)"],
    ["name", "Staff full name"], ["first_name", "First name"], ["role", "Designation / role"], ["department", "Department"],
    ["employee_code", "Employee code"], ["joining_date", "Joining date"], ["salary", "Monthly salary (basic)"],
    ["company", "Company name"], ["company_address", "Company address"], ["date", "Today's date"], ["phone", "Phone"], ["email", "Email"],
  ],
  payslip: [
    ["name", "Staff full name"], ["employee_code", "Employee code"], ["role", "Position"], ["department", "Department"],
    ["company", "Company name"], ["company_address", "Company address"], ["period", "Pay period (e.g. October 2026)"], ["pay_date", "Pay date"],
    ["pan", "PAN"], ["basic", "Basic salary"], ["leave_bonus", "Leave bonus"], ["overtime", "Overtime"], ["other_allowances", "Other allowances"],
    ["gross", "Total earnings"], ["net_words", "Net amount in words"], ["contact_no", "Contact number"], ["employee_id", "Employee ID"], ["joining_short", "Joining date (22 Oct 2025)"], ["pay_date_dot", "Pay date (09.07.2026)"], ["period_short", "Pay period (Jun'26)"], ["pf", "PF"], ["tds", "TDS"], ["other_deductions", "Other deductions (includes fines)"], ["fines", "Fines this month"], ["retention", "Retention"],
    ["total_deductions", "Total deductions"], ["net", "Net payable"], ["joining_date", "Joining date"],
  ],
};

const EXIT_COMMON = [
  ["name", "Staff full name"], ["first_name", "First name"], ["role", "Designation / role"], ["department", "Department"], ["employee_code", "Employee code"],
  ["joining_date", "Joining date"], ["resignation_date", "Resignation / notice date"], ["last_working_day", "Last working day"], ["tenure", "Length of service (e.g. 2 years 3 months)"],
  ["opening_line", "Opening sentence (changes with resignation / termination / contract end)"], ["company", "Company name"], ["company_address", "Company address"], ["date", "Today's date"],
];
FIELDS.relieving_letter = EXIT_COMMON;
FIELDS.experience_letter = EXIT_COMMON;
FIELDS.fnf_statement = [...EXIT_COMMON,
  ["pending_salary", "Pending salary"], ["leave_encashment", "Leave encashment"], ["bonus", "Bonus / incentive"], ["other_earnings", "Other payments"], ["total_earnings", "Total payable"],
  ["notice_recovery", "Notice shortfall recovery"], ["fines", "Fines pending"], ["advance", "Advance / loan recovery"], ["other_deductions", "Other deductions"], ["total_deductions", "Total deductions"],
  ["net", "Net settlement amount"], ["net_words", "Net amount in words"]];
export const EXIT_KINDS = ["relieving_letter", "experience_letter", "fnf_statement"];

const money = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const longDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (n) => `${String(n).padStart(2, "0")}${[11, 12, 13].includes(n % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th")}`;
/** 2026-09-01 -> "01st September 2026" (the style used in the clinic's offer letters) */
export const ordDate = (d) => { if (!d) return ""; const x = new Date(d); if (isNaN(x)) return ""; return `${ordinal(x.getDate())} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const shortDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

// Everything an offer letter can change per person. "list" = one line per bullet.
export const OFFER_META = {
  letter_date: ["Letter date", "text"], name: ["Candidate name", "text"], address: ["Candidate address", "long"], role: ["Job title", "text"],
  department: ["Department", "text"], joining_date: ["Joining date", "text"], gross_salary: ["Gross salary per month (Rs.)", "text"],
  net_salary: ["Net monthly salary (Rs.)", "text"], retention_bonus: ["Retention bonus per month (Rs.)", "text"], payout_day: ["Salary payout day", "text"],
  probation: ["Probation period", "text"], duties: ["Job responsibilities (one per line)", "list"],
};
function dutiesFor(role) {
  const r = db.prepare("SELECT duties FROM role_duties WHERE lower(designation) = lower(?)").get(role || "");
  return r ? JSON.parse(r.duties) : [];
}
function offerDefaults(user, profile) {
  const net = (profile?.basic_salary || 0) + (profile?.other_allowances || 0);
  const ret = profile?.retention || 0;
  const role = profile?.position || user.designation || "";
  return {
    letter_date: ordDate(new Date()), address: (user.address || "").replace(/\r?\n/g, "\n"), joining_date: ordDate(user.joined_at),
    gross_salary: net || ret ? money(net + ret) : "", net_salary: net ? money(net) : "", retention_bonus: ret ? money(ret) : "",
    payout_day: "10th", probation: "3 months", duties: dutiesFor(role),
  };
}

export function valuesFor(kind, user, profile0, company, period, extra = {}) {
  const profile = kind === "payslip" && profile0 ? withFines(profile0, period) : profile0;
  const base = {
    name: user.name, first_name: (user.name || "").split(" ")[0], role: profile?.position || user.designation || user.role_name || "",
    department: user.department || "", employee_code: profile?.employee_code || user.employee_code || "",
    joining_date: longDate(user.joined_at), company: company?.name || "", company_address: company?.address || "",
    date: longDate(new Date()), phone: user.phone || "", email: user.email || "",
    salary: money(profile?.basic_salary),
  };
  if (kind === "offer_letter") Object.assign(base, offerDefaults(user, profile));
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
      net_words: `${inWords(Math.max(0, gross - ded))} Only`, contact_no: user.phone || "", employee_id: profile?.employee_code || "",
      joining_short: shortDate(user.joined_at), pay_date_dot: new Date(extra.payDate || Date.now()).toLocaleDateString("en-GB").replace(/\//g, "."),
      period_short: y && m ? `${MONTHS[Number(m) - 1].slice(0, 3)}'${y.slice(2)}` : "",
    });
  }
  return { ...base, ...extra.fields };
}

export function render(templatePath, values) {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(values);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// Builds a tiny valid .docx from plain paragraphs (used for the downloadable sample templates).
export function buildDocx(paragraphs) {
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

export const SAMPLES = {
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

SAMPLES.relieving_letter = [
  { text: "{company}", bold: true }, { text: "{company_address}" }, { text: "" }, { text: "Date: {date}" }, { text: "" },
  { text: "RELIEVING LETTER", bold: true }, { text: "" },
  { text: "Dear {name}," }, { text: "" },
  { text: "{opening_line}" },
  { text: "We confirm that you stand relieved from your duties as {role} in the {department} department with effect from the close of working hours on {last_working_day}. Your employee code was {employee_code}." },
  { text: "You have completed the handover of your work and returned all clinic property, and your full and final settlement has been processed as per the attached statement." },
  { text: "You are reminded that the confidentiality of patient information and clinic records continues to bind you after your employment ends." },
  { text: "We thank you for your service during your time with us and wish you every success in the future." }, { text: "" },
  { text: "Yours sincerely," }, { text: "Dr. Nishita Ranka", bold: true }, { text: "Founder & Medical Director" },
];
SAMPLES.experience_letter = [
  { text: "{company}", bold: true }, { text: "{company_address}" }, { text: "" }, { text: "Date: {date}" }, { text: "" },
  { text: "EXPERIENCE CERTIFICATE", bold: true }, { text: "" },
  { text: "TO WHOMSOEVER IT MAY CONCERN", bold: true }, { text: "" },
  { text: "This is to certify that {name} (Employee Code: {employee_code}) worked with {company} as {role} in the {department} department from {joining_date} to {last_working_day}, a period of {tenure}." },
  { text: "During this period, {first_name} carried out the assigned responsibilities sincerely, and their conduct was found to be satisfactory." },
  { text: "We wish {first_name} all the very best in future endeavours." }, { text: "" },
  { text: "Yours sincerely," }, { text: "Dr. Nishita Ranka", bold: true }, { text: "Founder & Medical Director" },
];
SAMPLES.fnf_statement = [
  { text: "{company}", bold: true }, { text: "{company_address}" }, { text: "" }, { text: "Date: {date}" }, { text: "" },
  { text: "FULL AND FINAL SETTLEMENT STATEMENT", bold: true }, { text: "" },
  { text: "Employee: {name}  ({employee_code})" }, { text: "Designation: {role}    Department: {department}" },
  { text: "Date of joining: {joining_date}    Last working day: {last_working_day}" }, { text: "" },
  { text: "PAYABLE TO EMPLOYEE", bold: true },
  { text: "Pending salary: Rs. {pending_salary}" }, { text: "Leave encashment: Rs. {leave_encashment}" }, { text: "Bonus / incentive: Rs. {bonus}" }, { text: "Other payments: Rs. {other_earnings}" },
  { text: "Total payable: Rs. {total_earnings}", bold: true }, { text: "" },
  { text: "RECOVERIES", bold: true },
  { text: "Notice shortfall: Rs. {notice_recovery}" }, { text: "Fines: Rs. {fines}" }, { text: "Advance / loan: Rs. {advance}" }, { text: "Other deductions: Rs. {other_deductions}" },
  { text: "Total deductions: Rs. {total_deductions}", bold: true }, { text: "" },
  { text: "NET SETTLEMENT: Rs. {net} (Rupees {net_words} only)", bold: true }, { text: "" },
  { text: "I acknowledge receipt of the above amount in full and final settlement of all my dues. I have no further claim against {company}." }, { text: "" },
  { text: "Employee signature: ____________________        Authorised signatory: ____________________" },
];

// First start: install the clinic's own offer letter (from the sample the clinic supplied) so it works with no set-up.
export const OFFER_ASSET = path.join(__dirname, "..", "..", "assets", "offer-letter-template.docx");
if (fs.existsSync(OFFER_ASSET) && !db.prepare("SELECT 1 FROM doc_templates WHERE kind = 'offer_letter'").get()) {
  const id = randomUUID(), dest = path.join(TPL_DIR, `${id}.docx`);
  fs.copyFileSync(OFFER_ASSET, dest);
  db.prepare("INSERT INTO doc_templates (id, kind, name, file_path, file_name) VALUES (?, 'offer_letter', ?, ?, ?)").run(id, "Standard offer letter (Dr. Nishita's Clinic)", dest, "standard-offer-letter-template.docx");
}

templatesRouter.get("/fields", requireAuth, adminOnly, (req, res) => {
  res.json(Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, v.map(([key, label]) => ({ key, label }))])));
});

templatesRouter.get("/sample/:kind", requireAuth, adminOnly, (req, res) => {
  if (req.params.kind === "offer_letter" && fs.existsSync(OFFER_ASSET)) {
    res.setHeader("Content-Disposition", 'attachment; filename="standard-offer-letter-template.docx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return res.send(fs.readFileSync(OFFER_ASSET));
  }
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
  if (!FIELDS[kind]) return res.status(400).json({ error: "Choose the type of template" });
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

// ---- Placeholders found inside an uploaded template, so the screen can show exactly the fields that letter needs ----
function placeholdersIn(file) {
  const zip = new PizZip(fs.readFileSync(file));
  let text = "";
  for (const name of Object.keys(zip.files)) if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) text += zip.file(name).asText().replace(/<[^>]+>/g, "");
  const keys = [];
  for (const m of text.matchAll(/\{([#^\/]?)([\w.]+)\}/g)) if (m[2] !== "." && !keys.includes(m[2])) keys.push(m[2]);
  return keys;
}
const TAG_META = Object.fromEntries(Object.values(FIELDS).flat().map(([k, l]) => [k, l]));
const toForm = (v) => (Array.isArray(v) ? v.join("\n") : v ?? "");

// Which fields does this template use, and what would each person's letter say right now?
templatesRouter.post("/prefill", requireAuth, adminOnly, (req, res) => {
  const { templateId, userIds, period } = req.body || {};
  const t = db.prepare("SELECT * FROM doc_templates WHERE id = ?").get(templateId);
  if (!t) return res.status(404).json({ error: "Template not found" });
  const keys = placeholdersIn(t.file_path);
  const fields = keys.map((k) => ({ key: k, label: OFFER_META[k]?.[0] || TAG_META[k] || k.replace(/_/g, " "), type: OFFER_META[k]?.[1] || "text" }));
  const base = `SELECT u.*, d.name AS department, r.name AS role_name FROM users u LEFT JOIN departments d ON d.id = u.department_id JOIN roles r ON r.id = u.role_id WHERE u.active = 1`;
  let users = db.prepare(base).all();
  if (Array.isArray(userIds) && userIds.length) users = users.filter((u) => userIds.includes(u.id));
  const people = users.map((u) => {
    const profile = db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(u.id);
    const companyId = t.company_id || profile?.company_id || null;
    const company = companyId ? db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) : null;
    const v = valuesFor(t.kind, u, profile, company, period);
    return { id: u.id, name: u.name, values: Object.fromEntries(keys.map((k) => [k, toForm(v[k])])) };
  });
  res.json({ fields, people });
});

const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_");

// POST /api/doc-templates/generate  { templateId, userIds?: [] (omit = everyone who fits), period?: 'YYYY-MM' }
templatesRouter.post("/generate", requireAuth, adminOnly, async (req, res) => {
  const { templateId, userIds, period, overrides, emailAfter } = req.body || {};
  const t = db.prepare("SELECT * FROM doc_templates WHERE id = ?").get(templateId);
  if (!t) return res.status(404).json({ error: "Template not found" });
  if (EXIT_KINDS.includes(t.kind)) return res.status(400).json({ error: "Relieving, experience and settlement letters are made from the Staff exits page, one person at a time." });
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
      // Anything the admin edited on screen wins over the automatic value. "list" fields become one bullet per line.
      const ov = overrides?.[u.id] || {};
      const fields = {};
      for (const [k, v] of Object.entries(ov)) fields[k] = OFFER_META[k]?.[1] === "list" ? String(v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : String(v);
      if (t.kind === "offer_letter" && fields.duties?.length) {
        const role = fields.role || profile?.position || u.designation || "";
        if (role) db.prepare("INSERT INTO role_duties (designation, duties) VALUES (?, ?) ON CONFLICT(designation) DO UPDATE SET duties = excluded.duties").run(role, JSON.stringify(fields.duties));
      }
      const buf = render(t.file_path, valuesFor(t.kind, u, profile, company, period, { fields }));
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
  let emailed = 0; const emailFailed = [];
  if (emailAfter) {
    if (!isEmailConfigured()) emailFailed.push({ name: "Everyone", reason: "Email is not set up yet (System & Backups → Email settings)" });
    else for (const r of results) {
      const g = db.prepare("SELECT * FROM generated_docs WHERE id = ?").get(r.id);
      const x = await emailGenerated(g); if (x.ok) emailed++; else emailFailed.push({ name: r.name, reason: x.error });
    }
  }
  res.status(201).json({ generated: results, skipped, emailed, emailFailed });
});

// Email generated files (payslips, letters) to each person's own email address.
const KIND_LABEL = { payslip: "payslip", offer_letter: "offer letter" };
async function emailGenerated(g) {
  const u = db.prepare("SELECT name, email FROM users WHERE id = ?").get(g.user_id);
  if (!u?.email) { db.prepare("UPDATE generated_docs SET email_error = ? WHERE id = ?").run("No email address on file", g.id); return { ok: false, error: "No email address on file" }; }
  if (!fs.existsSync(g.file_path)) return { ok: false, error: "File missing" };
  const what = KIND_LABEL[g.kind] || "document";
  try {
    await sendEmail({
      to: u.email,
      subject: `Your ${what}${g.period ? ` — ${g.period}` : ""} — Dr. Nishita's Clinic`,
      html: `<p>Hi ${u.name},</p><p>Please find your ${what}${g.period ? ` for ${g.period}` : ""} attached.</p><p>Regards,<br>Dr. Nishita's Clinic</p>`,
      attachments: [{ filename: g.file_name, path: g.file_path }],
    });
    db.prepare("UPDATE generated_docs SET emailed_at = datetime('now'), email_error = NULL WHERE id = ?").run(g.id);
    return { ok: true };
  } catch (e) {
    const msg = friendlyMailError(e);
    db.prepare("UPDATE generated_docs SET email_error = ? WHERE id = ?").run(msg, g.id);
    return { ok: false, error: msg };
  }
}
templatesRouter.post("/generated/email", requireAuth, adminOnly, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: "Nothing selected" });
  if (!isEmailConfigured()) return res.status(503).json({ error: "Email is not set up yet. Open System & Backups → Email settings first." });
  const sent = [], failed = [];
  for (const id of ids) {
    const g = db.prepare("SELECT g.*, u.name AS user_name FROM generated_docs g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?").get(id);
    if (!g) continue;
    const r = await emailGenerated(g);
    (r.ok ? sent : failed).push(r.ok ? g.user_name : { name: g.user_name, reason: r.error });
  }
  res.json({ sent, failed });
});

templatesRouter.get("/generated", requireAuth, adminOnly, (req, res) => {
  const { kind } = req.query;
  res.json(db.prepare(
    `SELECT g.id, g.kind, g.period, g.file_name, g.created_at, g.emailed_at, g.email_error, u.name AS user_name, c.name AS company
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
