// Staff exits: resignation / termination / contract end -> notice -> handover -> settlement -> relieved.
// Admin only. Produces the relieving letter, experience certificate and full & final settlement statement.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { finesTotal } from "./fines.js";
import { render, buildDocx, SAMPLES, valuesFor, GEN_DIR, EXIT_KINDS } from "./documents.js";

const router = Router();
const adminOnly = (req, res, next) => (req.user?.roleName === "admin" ? next() : res.status(403).json({ error: "Admin only" }));
router.use(requireAuth, adminOnly);

db.exec(`
CREATE TABLE IF NOT EXISTS exits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'received',
  reason_type TEXT NOT NULL DEFAULT 'resignation',   -- resignation | termination | contract_end
  reason_note TEXT,
  resignation_date TEXT NOT NULL,
  last_working_day TEXT NOT NULL,
  notice_days INTEGER NOT NULL DEFAULT 30,
  clearance TEXT NOT NULL DEFAULT '{}',              -- { key: true }
  settlement TEXT NOT NULL DEFAULT '{}',             -- manual inputs for the F&F sheet
  settlement_saved INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS exit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, exit_id TEXT NOT NULL REFERENCES exits(id),
  text TEXT NOT NULL, by_name TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

export const EXIT_STATUSES = [
  { key: "received", label: "Resignation received", hint: "Notice recorded. Confirm the last working day." },
  { key: "notice", label: "Serving notice", hint: "Person is working out the notice period." },
  { key: "handover", label: "Handover & clearance", hint: "Hand over work, return clinic property, close accounts." },
  { key: "settlement", label: "Settlement in progress", hint: "Prepare the full & final settlement sheet." },
  { key: "paid", label: "Settlement paid", hint: "Money paid. Letters can now be issued." },
  { key: "relieved", label: "Relieved", hint: "Done. Login is switched off." },
];
const ORDER = EXIT_STATUSES.map((s) => s.key);
export const CLEARANCE = [
  ["handover_work", "Work handed over to a colleague"], ["return_id_card", "ID card returned"], ["return_keys_assets", "Keys, uniform and other property returned"],
  ["accounts_closed", "Software / WhatsApp group / system access closed"], ["dues_checked", "Pending dues and fines checked"], ["exit_talk", "Exit conversation done"],
];
const REASONS = { resignation: "Resignation", termination: "Termination", contract_end: "End of contract" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };

function inWords(n) { // Indian numbering
  n = Math.round(n);
  if (n === 0) return "Zero";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + " Crore"); if (lk) parts.push(two(lk) + " Lakh"); if (th) parts.push(two(th) + " Thousand"); if (n) parts.push(three(n));
  return parts.join(" ");
}
const longDate = (d) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const rs = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function tenure(from, to) {
  if (!from || !to) return "";
  const a = new Date(from), b = new Date(to);
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  if (m < 0) m = 0;
  const y = Math.floor(m / 12), mo = m % 12;
  const p = [];
  if (y) p.push(`${y} year${y > 1 ? "s" : ""}`); if (mo) p.push(`${mo} month${mo > 1 ? "s" : ""}`);
  if (!p.length) { const d = Math.max(0, Math.round((b - a) / 86400000)); return `${d} day${d === 1 ? "" : "s"}`; }
  return p.join(" ");
}

// The money sheet. Inputs are what the admin types; everything else is worked out here.
function calc(row) {
  const s = JSON.parse(row.settlement || "{}");
  const p = db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(row.user_id);
  const monthlyGross = (p?.basic_salary || 0) + (p?.leave_bonus || 0) + (p?.other_allowances || 0);
  const perDay = monthlyGross / 30, perDayBasic = (p?.basic_salary || 0) / 30;
  const unpaid = num(s.unpaid_days), leave = num(s.leave_days), short = num(s.notice_short_days);
  const out = {
    inputs: { unpaid_days: unpaid, leave_days: leave, bonus: num(s.bonus), other_earnings: num(s.other_earnings), notice_short_days: short, advance: num(s.advance), other_deductions: num(s.other_deductions) },
    monthly_gross: Math.round(monthlyGross), per_day: Math.round(perDay * 100) / 100, has_pay_profile: !!p,
  };
  out.pending_salary = Math.round(unpaid * perDay);
  out.leave_encashment = Math.round(leave * perDayBasic);
  out.total_earnings = out.pending_salary + out.leave_encashment + out.inputs.bonus + out.inputs.other_earnings;
  out.notice_recovery = Math.round(short * perDay);
  out.fines = finesTotal(row.user_id, row.last_working_day.slice(0, 7));
  out.total_deductions = out.notice_recovery + out.fines + out.inputs.advance + out.inputs.other_deductions;
  out.net = out.total_earnings - out.total_deductions;
  out.net_words = inWords(Math.abs(out.net));
  return out;
}

function view(row) {
  const u = db.prepare("SELECT u.name, u.designation, u.joined_at, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?").get(row.user_id);
  const letters = db.prepare("SELECT id, kind, file_name, created_at FROM generated_docs WHERE user_id = ? AND kind IN ('relieving_letter','experience_letter','fnf_statement') ORDER BY created_at DESC").all(row.user_id);
  const events = db.prepare("SELECT text, by_name, at FROM exit_events WHERE exit_id = ? ORDER BY id DESC").all(row.id);
  return {
    ...row, clearance: JSON.parse(row.clearance || "{}"), settlement: calc(row),
    reason_label: REASONS[row.reason_type], staff_name: u?.name, designation: u?.designation, department: u?.department, joined_at: u?.joined_at,
    tenure: tenure(u?.joined_at, row.last_working_day), letters, events,
    clearance_items: CLEARANCE.map(([key, label]) => ({ key, label })), statuses: EXIT_STATUSES,
  };
}
const log = (id, req, text) => db.prepare("INSERT INTO exit_events (exit_id, text, by_name) VALUES (?,?,?)").run(id, text, db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.userId)?.name || null);

router.get("/meta", (req, res) => res.json({ statuses: EXIT_STATUSES, clearance: CLEARANCE.map(([key, label]) => ({ key, label })), reasons: REASONS }));

router.get("/", (req, res) => {
  const rows = db.prepare(
    `SELECT e.*, u.name AS staff_name, u.designation, d.name AS department FROM exits e JOIN users u ON u.id = e.user_id
     LEFT JOIN departments d ON d.id = u.department_id ORDER BY e.created_at DESC`).all();
  res.json(rows.map((r) => ({ ...r, reason_label: REASONS[r.reason_type], status_label: EXIT_STATUSES.find((s) => s.key === r.status)?.label || "Withdrawn" })));
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  row ? res.json(view(row)) : res.status(404).json({ error: "Not found" });
});

router.post("/", (req, res) => {
  const { userId, reasonType, reasonNote, resignationDate, lastWorkingDay, noticeDays } = req.body || {};
  const u = db.prepare("SELECT id, name, active FROM users WHERE id = ?").get(userId);
  if (!u || !u.active) return res.status(400).json({ error: "Choose an active staff member" });
  if (userId === req.user.userId) return res.status(400).json({ error: "You cannot start an exit for your own account" });
  if (!REASONS[reasonType]) return res.status(400).json({ error: "Choose the reason" });
  if (!DATE.test(resignationDate || "") || !DATE.test(lastWorkingDay || "")) return res.status(400).json({ error: "Enter the dates" });
  if (lastWorkingDay < resignationDate) return res.status(400).json({ error: "Last working day cannot be before the resignation date" });
  if (db.prepare("SELECT 1 FROM exits WHERE user_id = ? AND status NOT IN ('relieved','withdrawn')").get(userId)) return res.status(409).json({ error: "This person already has an exit in progress" });
  const id = randomUUID();
  db.prepare("INSERT INTO exits (id, user_id, reason_type, reason_note, resignation_date, last_working_day, notice_days, created_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, userId, reasonType, reasonNote ? String(reasonNote).slice(0, 500) : null, resignationDate, lastWorkingDay, Number(noticeDays) || 30, req.user.userId);
  log(id, req, `${REASONS[reasonType]} recorded for ${u.name}. Last working day ${longDate(lastWorkingDay)}.`);
  audit({ userId: req.user.userId, action: "EXIT_STARTED", detail: u.name });
  res.status(201).json(view(db.prepare("SELECT * FROM exits WHERE id = ?").get(id)));
});

// Edit dates, clearance ticks and the settlement inputs.
router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (["relieved", "withdrawn"].includes(row.status)) return res.status(400).json({ error: "This exit is closed" });
  const b = req.body || {};
  const f = {};
  if (b.lastWorkingDay !== undefined) { if (!DATE.test(b.lastWorkingDay) || b.lastWorkingDay < row.resignation_date) return res.status(400).json({ error: "Check the last working day" }); f.last_working_day = b.lastWorkingDay; }
  if (b.reasonNote !== undefined) f.reason_note = String(b.reasonNote).slice(0, 500);
  if (b.clearance && typeof b.clearance === "object") {
    const cur = JSON.parse(row.clearance || "{}");
    for (const [k] of CLEARANCE) if (k in b.clearance) cur[k] = !!b.clearance[k];
    f.clearance = JSON.stringify(cur);
  }
  if (b.settlement && typeof b.settlement === "object") {
    const cur = JSON.parse(row.settlement || "{}");
    for (const k of ["unpaid_days", "leave_days", "bonus", "other_earnings", "notice_short_days", "advance", "other_deductions"]) if (k in b.settlement) cur[k] = num(b.settlement[k]);
    f.settlement = JSON.stringify(cur); f.settlement_saved = 1;
  }
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE exits SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).run(...keys.map((k) => f[k]), row.id);
  if (f.settlement) log(row.id, req, "Settlement sheet saved.");
  res.json(view(db.prepare("SELECT * FROM exits WHERE id = ?").get(row.id)));
});

router.post("/:id/advance", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const i = ORDER.indexOf(row.status);
  if (i < 0 || i >= ORDER.length - 1) return res.status(400).json({ error: "Nothing further to do" });
  const next = ORDER[i + 1];
  if (next === "settlement") {
    const c = JSON.parse(row.clearance || "{}");
    const missing = CLEARANCE.filter(([k]) => !c[k]).map(([, l]) => l);
    if (missing.length) return res.status(400).json({ error: `Finish clearance first: ${missing.join("; ")}` });
  }
  if (next === "paid" && !row.settlement_saved) return res.status(400).json({ error: "Fill in and save the settlement sheet first" });
  if (next === "paid" && !db.prepare("SELECT 1 FROM generated_docs WHERE user_id = ? AND kind = 'fnf_statement' AND created_at >= ?").get(row.user_id, row.created_at)) {
    return res.status(400).json({ error: "Create the settlement statement before marking it paid" });
  }
  if (next === "relieved") {
    for (const k of ["relieving_letter", "experience_letter"]) {
      if (!db.prepare("SELECT 1 FROM generated_docs WHERE user_id = ? AND kind = ? AND created_at >= ?").get(row.user_id, k, row.created_at)) {
        return res.status(400).json({ error: "Create the relieving letter and the experience certificate first" });
      }
    }
    const t = db.prepare("SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(row.user_id);
    if (t?.role === "admin" && db.prepare("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name='admin' AND u.active=1").get().n <= 1) {
      return res.status(400).json({ error: "This is the only active admin and cannot be relieved." });
    }
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(row.user_id);
    db.prepare("UPDATE exits SET closed_at = datetime('now') WHERE id = ?").run(row.id);
  }
  db.prepare("UPDATE exits SET status = ? WHERE id = ?").run(next, row.id);
  log(row.id, req, `Moved to: ${EXIT_STATUSES[i + 1].label}.${next === "relieved" ? " Login switched off." : ""}`);
  res.json(view(db.prepare("SELECT * FROM exits WHERE id = ?").get(row.id)));
});

router.post("/:id/back", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const i = ORDER.indexOf(row.status);
  if (i <= 0 || row.status === "relieved") return res.status(400).json({ error: "Cannot go back from here" });
  db.prepare("UPDATE exits SET status = ? WHERE id = ?").run(ORDER[i - 1], row.id);
  log(row.id, req, `Moved back to: ${EXIT_STATUSES[i - 1].label}.`);
  res.json(view(db.prepare("SELECT * FROM exits WHERE id = ?").get(row.id)));
});

router.post("/:id/withdraw", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (["relieved", "withdrawn"].includes(row.status)) return res.status(400).json({ error: "This exit is already closed" });
  db.prepare("UPDATE exits SET status = 'withdrawn', closed_at = datetime('now') WHERE id = ?").run(row.id);
  log(row.id, req, "Exit withdrawn. The person continues to work.");
  res.json(view(db.prepare("SELECT * FROM exits WHERE id = ?").get(row.id)));
});

const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_");
const FILE_LABEL = { relieving_letter: "RelievingLetter", experience_letter: "ExperienceCertificate", fnf_statement: "FullAndFinalSettlement" };

// Make one of the three documents. Uses the template you uploaded (company-specific first), else the built-in wording.
router.post("/:id/letters", (req, res) => {
  const row = db.prepare("SELECT * FROM exits WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  const kind = req.body?.kind;
  if (!EXIT_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown document" });
  const i = ORDER.indexOf(row.status);
  if (row.status === "withdrawn") return res.status(400).json({ error: "This exit was withdrawn" });
  if (kind === "fnf_statement" && !row.settlement_saved) return res.status(400).json({ error: "Fill in and save the settlement sheet first" });
  if (kind !== "fnf_statement" && i < ORDER.indexOf("paid")) return res.status(400).json({ error: "Relieving and experience letters are issued after the settlement is paid" });

  const u = db.prepare("SELECT u.*, d.name AS department, r.name AS role_name FROM users u LEFT JOIN departments d ON d.id = u.department_id JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(row.user_id);
  const profile = db.prepare("SELECT * FROM pay_profiles WHERE user_id = ?").get(u.id);
  const company = profile?.company_id ? db.prepare("SELECT * FROM companies WHERE id = ?").get(profile.company_id) : db.prepare("SELECT * FROM companies ORDER BY rowid LIMIT 1").get();
  const s = calc(row);
  const opening = row.reason_type === "resignation"
    ? `With reference to your resignation dated ${longDate(row.resignation_date)}, which has been accepted by the management,`
    : row.reason_type === "termination"
      ? `With reference to the termination of your services communicated on ${longDate(row.resignation_date)},`
      : `Your fixed-term contract of employment with us comes to an end on ${longDate(row.last_working_day)}, and`;
  const fields = {
    resignation_date: longDate(row.resignation_date), last_working_day: longDate(row.last_working_day), tenure: tenure(u.joined_at, row.last_working_day),
    opening_line: opening, pending_salary: rs(s.pending_salary), leave_encashment: rs(s.leave_encashment), bonus: rs(s.inputs.bonus), other_earnings: rs(s.inputs.other_earnings),
    total_earnings: rs(s.total_earnings), notice_recovery: rs(s.notice_recovery), fines: rs(s.fines), advance: rs(s.inputs.advance), other_deductions: rs(s.inputs.other_deductions),
    total_deductions: rs(s.total_deductions), net: rs(s.net), net_words: s.net < 0 ? `Minus ${s.net_words}` : s.net_words,
  };
  const tpl = db.prepare("SELECT * FROM doc_templates WHERE kind = ? AND (company_id = ? OR company_id IS NULL) ORDER BY (company_id IS NULL), created_at DESC").get(kind, company?.id || null);
  let source = tpl?.file_path, tmpPath = null;
  if (!source || !fs.existsSync(source)) { tmpPath = path.join(GEN_DIR, `tmp-${randomUUID()}.docx`); fs.writeFileSync(tmpPath, buildDocx(SAMPLES[kind])); source = tmpPath; }
  try {
    const buf = render(source, valuesFor(kind, u, profile, company, null, { fields }));
    const id = randomUUID(), fname = `${FILE_LABEL[kind]}_${safe(u.name)}.docx`, fpath = path.join(GEN_DIR, `${id}.docx`);
    fs.writeFileSync(fpath, buf);
    db.prepare("INSERT INTO generated_docs (id, template_id, kind, user_id, company_id, file_path, file_name, created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, tpl?.id || null, kind, u.id, company?.id || null, fpath, fname, req.user.userId);
    log(row.id, req, `${fname.replace(/_.*/, "")} created.`);
    res.status(201).json({ id, file_name: fname, used: tpl ? "your uploaded template" : "the standard wording" });
  } catch (e) {
    res.status(400).json({ error: "Your uploaded template could not be filled. Check its {placeholders}." });
  } finally { if (tmpPath) fs.rm(tmpPath, { force: true }, () => {}); }
});

export default router;
