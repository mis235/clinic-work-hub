import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CLINIC_DB_FILE lets test scripts point at a throwaway database instead of the real one.
// DATA_DIR points at a persistent disk when hosted (e.g. /var/data on Render); locally it defaults to backend/.
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = process.env.CLINIC_DB_FILE || "clinic.db";
const db = new Database(path.join(dataDir, dbFile));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// RBAC core: USER -> ROLE -> DEPARTMENT -> PERMISSION -> ACTION
// This is the single source of truth for authorization across every device
// and every channel (web, PWA, WhatsApp). Nothing checks "is this an admin
// device" anywhere in the codebase — only "does this user's role grant this
// permission".
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE          -- 'admin' | 'manager' | 'staff' (extensible)
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL UNIQUE        -- e.g. 'task:assign', 'task:view_all', 'staff:manage'
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,                 -- used for WhatsApp matching; nullable for system-only accounts
  email TEXT UNIQUE,                 -- used for password login (admins/managers) AND payslip/notification delivery for everyone
  password_hash TEXT,                -- for email/password login
  pin_hash TEXT,                     -- for quick PIN login (mobile-friendly, staff)
  role_id TEXT NOT NULL REFERENCES roles(id),
  department_id TEXT REFERENCES departments(id),
  active INTEGER NOT NULL DEFAULT 1,
  birthday TEXT,                      -- 'MM-DD' format, nullable until provided
  joined_at TEXT,                     -- ISO date, used to compute years of experience
  designation TEXT,                   -- job title, e.g. "MIS", "COS", "Director" — shown in the Staff directory
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every device/session a user is logged in on. Lets us show "Devices" and
-- support remote revocation, per the multi-device security requirement.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_label TEXT,                 -- e.g. "Chrome on Windows", "iPhone PWA"
  channel TEXT NOT NULL DEFAULT 'web', -- 'web' | 'pwa' | 'whatsapp'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  default_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The single, central task record. Every channel (web, PWA, WhatsApp) reads
-- and writes to this same table — this is what makes "accept on WhatsApp,
-- see it on desktop instantly" possible: there is only ever one record.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|accepted|in_progress|done|extension_requested|issue_reported
  whatsapp_message_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  event TEXT NOT NULL,
  detail TEXT,
  channel TEXT NOT NULL DEFAULT 'web',   -- which channel produced this event
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_inbound_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_phone TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  matched_task_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- Policies: versioned documents every staff member must acknowledge reading.
-- A new version does NOT retroactively count old acknowledgments -- if the
-- text changes, everyone needs to re-acknowledge, so admin can always see
-- exactly who has and hasn't read the CURRENT version of each policy.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,          -- e.g. 'HR', 'Clinical', 'Conduct', 'Safety'
  body TEXT NOT NULL,              -- markdown/plain text content
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_acknowledgments (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  policy_version INTEGER NOT NULL,   -- which version was acknowledged
  user_id TEXT NOT NULL REFERENCES users(id),
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(policy_id, policy_version, user_id)
);

-- --------------------------------------------------------------------------
-- Remaining Google Site sections: Management/team profiles, HR offer letters,
-- Learning & Resources training videos, and Upcoming Events. These pages were
-- EMPTY on the source site, so there's no content to migrate -- these tables
-- exist so admin has somewhere real to put content once it's ready, not
-- because I invented data to fill them.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  bio TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offer_letters (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),  -- nullable: an offer letter can be issued before the person has a login yet
  candidate_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  department TEXT,
  salary_text TEXT,                    -- kept as free text -- currency/structure varies too much to force a schema
  start_date TEXT,
  body_text TEXT NOT NULL,             -- the generated letter, stored so it can be reprinted identically later
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS training_videos (
  id TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS training_video_views (
  video_id TEXT NOT NULL REFERENCES training_videos(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (video_id, user_id)
);

-- Festivals and one-off important dates (recurring yearly). Birthdays and
-- years-of-experience are NOT stored here -- they're computed live from
-- users.birthday and users.joined_at so there's only ever one place that
-- data lives.
CREATE TABLE IF NOT EXISTS clinic_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- 'festival' | 'important_date' | 'event'
  event_date TEXT NOT NULL,      -- MM-DD for recurring, or full ISO date for one-off events
  recurring INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- Multi-company payroll. You operate three legal entities (Shanta's Derma
-- Pharmacy, Dr. Nishita's Clinic, Dr. Nishita Skin Hair & Aesthetics) that
-- share one staff app but need separate letterheads and payslip records.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recurring monthly pay structure per employee. Admin sets this once; the
-- monthly payslip generator uses it as the default each month (a one-off
-- change like a bonus is entered when generating that month's slip, not
-- stored here permanently).
CREATE TABLE IF NOT EXISTS pay_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_code TEXT,          -- e.g. NC2025MIS02
  position TEXT,                -- e.g. "MIS Executive" -- shown on the payslip
  pan TEXT,
  basic_salary REAL NOT NULL DEFAULT 0,
  leave_bonus REAL NOT NULL DEFAULT 0,
  overtime REAL NOT NULL DEFAULT 0,
  other_allowances REAL NOT NULL DEFAULT 0,
  pf REAL NOT NULL DEFAULT 0,
  tds REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  retention REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One generated payslip per employee per month. Stored as a snapshot (not
-- recalculated from pay_profiles later) so a payslip never silently changes
-- after the fact even if the employee's ongoing salary structure changes.
CREATE TABLE IF NOT EXISTS payslips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  pay_period TEXT NOT NULL,        -- 'YYYY-MM'
  pay_date TEXT NOT NULL,          -- ISO date
  basic_salary REAL NOT NULL,
  leave_bonus REAL NOT NULL,
  overtime REAL NOT NULL,
  other_allowances REAL NOT NULL,
  pf REAL NOT NULL,
  tds REAL NOT NULL,
  other_deductions REAL NOT NULL,
  retention REAL NOT NULL,
  net_payable REAL NOT NULL,
  pdf_path TEXT,
  emailed_at TEXT,
  email_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, pay_period)
);

-- --------------------------------------------------------------------------
-- Biometric attendance via the staff member's own phone (WebAuthn).
-- No physical scanner: the phone's fingerprint/Face ID unlocks a
-- cryptographic credential registered to that user. The clinic never sees
-- or stores the actual fingerprint/face data — only the device vendor's OS
-- does that. We only store the public key half of a standard WebAuthn
-- credential, which is useless without the matching phone.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,               -- credential ID (base64url), from the authenticator
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key TEXT NOT NULL,          -- base64url-encoded public key
  counter INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,                 -- e.g. "iPhone 13 — registered 4 Sep"
  transports TEXT,                   -- JSON array, e.g. ["internal"]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived challenges between "start" and "verify" calls of a WebAuthn
-- ceremony. One row per in-flight attempt; deleted once consumed.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,             -- 'register' | 'checkin'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fine_date TEXT NOT NULL,            -- YYYY-MM-DD (India date the fine is for)
  category TEXT NOT NULL,             -- late | dress_code | misbehaviour | absent | other
  amount REAL NOT NULL,
  note TEXT,
  added_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fines_user_date ON fines(user_id, fine_date);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                -- 'check_in' | 'check_out'
  method TEXT NOT NULL DEFAULT 'biometric', -- 'biometric' | 'manual' (manual = admin override, always logged as such)
  latitude REAL,
  longitude REAL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Shift checklists: the recurring, section-based Opening / During-the-day /
-- End-of-day checklist each role fills in once per shift, with optional photo
-- evidence + AI check and role-specific KPI metrics. This is distinct from
-- "tasks" above, which are one-off items an admin assigns ad hoc. Ported from
-- the clinic's real Google Apps Script + Sheets checklist system (role_name
-- here matches the "Role" column from that system's submission log).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_checklist_templates (
  id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,           -- e.g. "Pharmacy Coordinator" — matches users.shift_role
  shift TEXT NOT NULL DEFAULT 'Morning', -- default shift this role usually works
  section TEXT NOT NULL,             -- e.g. "Opening", "During the Day", "End of Day"
  item_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shift_checklist_metric_fields (
  id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  field_name TEXT NOT NULL,          -- e.g. "Patients Counselled"
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shift_checklist_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  role_name TEXT NOT NULL,
  shift TEXT NOT NULL,               -- 'Morning' | 'Evening'
  work_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
  items_json TEXT NOT NULL,          -- [{ section, text, done }]
  metrics_json TEXT,                 -- { fieldName: value }
  completed INTEGER NOT NULL,
  total INTEGER NOT NULL,
  completion_pct INTEGER NOT NULL,
  photo_path TEXT,                   -- served from /uploads
  photo_live_timestamp TEXT,         -- captured client-side at the moment the photo was taken (anti-fraud, mirrors the real system)
  photo_ai_check TEXT,               -- AI verification verdict, or a plain-language reason it wasn't available
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, work_date, shift)
);
`);

// --- lightweight migrations for databases created before a column existed ---
// CREATE TABLE IF NOT EXISTS above only helps brand-new databases; anyone who
// seeded before this column was added needs it patched in. Safe to run every
// boot — it's a no-op once the column exists.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("users", "designation", "designation TEXT");
ensureColumn("users", "shift_role", "shift_role TEXT"); // which shift-checklist template this person fills in (matches shift_checklist_templates.role_name); null = no daily shift checklist

// --- Staff onboarding record (added for the Onboarding module) ---
ensureColumn("users", "employee_code", "employee_code TEXT");
ensureColumn("users", "employment_type", "employment_type TEXT");          // Full-time | Part-time | Contract | Intern
ensureColumn("users", "reporting_to", "reporting_to TEXT");                // name of the manager they report to
ensureColumn("users", "gender", "gender TEXT");
ensureColumn("users", "blood_group", "blood_group TEXT");
ensureColumn("users", "address", "address TEXT");
ensureColumn("users", "emergency_contact_name", "emergency_contact_name TEXT");
ensureColumn("users", "emergency_contact_phone", "emergency_contact_phone TEXT");
ensureColumn("users", "onboarding_docs", "onboarding_docs TEXT");          // JSON {docKey: true} — which paperwork has been collected
ensureColumn("users", "must_change_pin", "must_change_pin INTEGER NOT NULL DEFAULT 0");
// Live progress: a checklist row exists as 'in_progress' from the first tick, 'submitted' after Submit.
ensureColumn("shift_checklist_submissions", "status", "status TEXT NOT NULL DEFAULT 'submitted'");
ensureColumn("shift_checklist_submissions", "updated_at", "updated_at TEXT");

// --- Documents hub, document templates, generated documents, richer training ---
db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  department_id TEXT REFERENCES departments(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Document',   -- Sheet | Dashboard | Document | Report | Other
  kind TEXT NOT NULL DEFAULT 'file',           -- 'file' | 'link'
  url TEXT,                                    -- for links (Google Sheet, dashboard, ...)
  file_path TEXT,                              -- for uploaded files (private folder, served only via authenticated route)
  file_name TEXT,
  mime TEXT,
  size INTEGER,
  note TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doc_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                          -- 'offer_letter' | 'payslip'
  name TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id),    -- null = any company
  file_path TEXT NOT NULL,
  file_name TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS generated_docs (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES doc_templates(id),
  kind TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  company_id TEXT REFERENCES companies(id),
  period TEXT,
  file_path TEXT NOT NULL,
  file_name TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS app_links (
  key TEXT PRIMARY KEY,            -- 'assistant' | 'dashboard' | any future connected tool
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'lead' (admin + managers)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
db.prepare("INSERT OR IGNORE INTO app_links (key, title, url, audience) VALUES (?, ?, ?, ?)").run("assistant", "Clinic Assistant", "http://72.60.101.59:3005", "all");
db.prepare("INSERT OR IGNORE INTO app_links (key, title, url, audience) VALUES (?, ?, ?, ?)").run("dashboard", "Clinic Dashboards", "https://claude.ai/code/artifact/c04a5c65-a3ee-4deb-be45-01658e364d8d", "lead");
ensureColumn("documents", "staff_user_id", "staff_user_id TEXT REFERENCES users(id)");  // set = a personal HR file (ID proof, certificates...) visible to admin + that person only
ensureColumn("documents", "doc_type", "doc_type TEXT");                                   // key from the onboarding document checklist
ensureColumn("training_videos", "description", "description TEXT");
ensureColumn("training_videos", "file_path", "file_path TEXT");            // uploaded video file (private, streamed via authenticated route)
ensureColumn("training_videos", "mime", "mime TEXT");
ensureColumn("training_videos", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0");
ensureColumn("attendance", "note", "note TEXT");
ensureColumn("attendance", "selfie_path", "selfie_path TEXT");

export default db;
