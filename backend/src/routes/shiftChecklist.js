import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(process.env.DATA_DIR || path.join(__dirname, "..", ".."), "uploads");
const UPLOAD_DIR = path.join(UPLOAD_ROOT, "shift-checklist");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname || "") || ".jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — plenty for a phone-camera check-in photo
});

const router = Router();
try { db.exec("ALTER TABLE shift_checklist_submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'app'"); } catch {}  // 'app' = filled in here, 'sheet' = came from the old Google form / sheet
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
const getSetting = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const putSetting = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

// Only keep fields we know; a task photo must be one of our own uploaded files.
function cleanItems(items) {
  return items.map((i) => {
    const o = { section: String(i.section ?? ""), text: String(i.text ?? ""), done: !!i.done };
    if (typeof i.photoUrl === "string" && /^\/uploads\/shift-checklist\/[\w.-]+$/.test(i.photoUrl)) { o.photoUrl = i.photoUrl; if (i.photoAt) o.photoAt = String(i.photoAt).slice(0, 40); }
    return o;
  });
}


function todayISO() {
  return new Date(Date.now() + 19800000).toISOString().slice(0, 10); // India date
}

function templateFor(roleName) {
  const rows = db
    .prepare(`SELECT section, item_text, sort_order FROM shift_checklist_templates WHERE role_name = ? ORDER BY sort_order`)
    .all(roleName);
  const sections = [];
  for (const r of rows) {
    let sec = sections.find((s) => s.section === r.section);
    if (!sec) { sec = { section: r.section, items: [] }; sections.push(sec); }
    sec.items.push(r.item_text);
  }
  const metrics = db
    .prepare(`SELECT field_name FROM shift_checklist_metric_fields WHERE role_name = ? ORDER BY sort_order`)
    .all(roleName)
    .map((r) => r.field_name);
  return { sections, metrics };
}

// GET /api/shift-checklist/template — the logged-in user's own role template, for today.
router.get("/template", requireAuth, (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) {
    return res.status(404).json({ error: "No shift checklist is assigned to your role yet. Ask an admin to set one up from Staff." });
  }
  const { sections, metrics } = templateFor(user.shift_role);
  if (sections.length === 0) {
    return res.status(404).json({ error: `No checklist items found for "${user.shift_role}" yet.` });
  }
  res.json({ roleName: user.shift_role, sections, metrics });
});

// GET /api/shift-checklist/today — what the logged-in user has already submitted today (both shifts), if anything.
router.get("/today", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? ORDER BY shift`)
    .all(req.user.userId, todayISO());
  res.json(rows.map(serializeSubmission));
});

function serializeSubmission(row) {
  return {
    id: row.id,
    userId: row.user_id,
    shift: row.shift,
    workDate: row.work_date,
    items: JSON.parse(row.items_json),
    metrics: row.metrics_json ? JSON.parse(row.metrics_json) : null,
    completed: row.completed,
    total: row.total,
    completionPct: row.completion_pct,
    photoUrl: row.photo_path ? `/uploads/shift-checklist/${path.basename(row.photo_path)}` : null,
    photoLiveTimestamp: row.photo_live_timestamp,
    photoAiCheck: row.photo_ai_check,
    status: row.status || "submitted",
    updatedAt: row.updated_at || row.submitted_at,
    submittedAt: row.submitted_at,
    staffName: row.staff_name, // present only when joined in (admin list)
    roleName: row.role_name,
  };
}

async function runAiPhotoCheck(filePath, mimeType) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "AI photo check unavailable — no ANTHROPIC_API_KEY configured on the server.";
  }
  try {
    const bytes = fs.readFileSync(filePath);
    const base64 = bytes.toString("base64");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 150,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: base64 } },
            { type: "text", text: "This is a staff check-in photo submitted as evidence of completed clinic work (e.g. a cleaned room, stocked shelf, or completed task). In one short sentence, say whether the photo looks genuine and usable (clear, well-lit, not a screenshot or an obviously unrelated image) or flag a problem with it." },
          ],
        }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return `(AI photo check returned no result: ${JSON.stringify(data?.error || data)})`;
    }
    return data.content?.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() || "(AI photo check returned an empty result.)";
  } catch (err) {
    return `(AI photo check failed: ${err.message})`;
  }
}

// POST /api/shift-checklist/item-photo — a live photo for ONE task (multipart: photo). Returns where it was saved;
// the page keeps it on that task and it is stored with the checklist when progress is saved.
router.post("/item-photo", requireAuth, requirePermission("shiftchecklist:submit"), upload.single("photo"), (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype || "")) { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); return res.status(400).json({ error: "Take or choose a photo" }); }
  res.status(201).json({ url: `/uploads/shift-checklist/${path.basename(req.file.path)}`, takenAt: new Date().toISOString() });
});

// POST /api/shift-checklist/progress — autosave while the checklist is being filled in.
// JSON { shift, items:[{section,text,done}], metrics }. Creates the day's row as 'in_progress'
// (so managers see live progress); never downgrades an already-submitted row's status.
router.post("/progress", requireAuth, requirePermission("shiftchecklist:submit"), (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) return res.status(400).json({ error: "No shift checklist is assigned to your role." });
  const { shift, metrics } = req.body || {};
  if (!shift || !Array.isArray(req.body?.items) || req.body.items.length === 0) return res.status(400).json({ error: "shift and items are required" });
  const items = cleanItems(req.body.items);
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((completed / total) * 100);
  db.prepare(`
    INSERT INTO shift_checklist_submissions
      (id, user_id, role_name, shift, work_date, items_json, metrics_json, completed, total, completion_pct, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', datetime('now'))
    ON CONFLICT(user_id, work_date, shift) DO UPDATE SET
      items_json = excluded.items_json, metrics_json = excluded.metrics_json,
      completed = excluded.completed, total = excluded.total, completion_pct = excluded.completion_pct,
      updated_at = datetime('now')
  `).run(randomUUID(), req.user.userId, user.shift_role, shift, todayISO(), JSON.stringify(items), metrics ? JSON.stringify(metrics) : null, completed, total, pct);
  const row = db.prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? AND shift = ?`).get(req.user.userId, todayISO(), shift);
  res.json(serializeSubmission(row));
});

// POST /api/shift-checklist/submit
// multipart/form-data: shift, items (JSON string [{section,text,done}]), metrics (JSON string, optional),
// photoLiveTimestamp (string, captured client-side when the photo was taken), photo (file, optional).
router.post("/submit", requireAuth, requirePermission("shiftchecklist:submit"), upload.single("photo"), async (req, res) => {
  const user = db.prepare(`SELECT shift_role FROM users WHERE id = ?`).get(req.user.userId);
  if (!user?.shift_role) return res.status(400).json({ error: "No shift checklist is assigned to your role." });

  const { shift, photoLiveTimestamp } = req.body;
  if (!shift) return res.status(400).json({ error: "shift is required" });

  let items, metrics;
  try {
    items = JSON.parse(req.body.items || "[]");
    metrics = req.body.metrics ? JSON.parse(req.body.metrics) : null;
  } catch {
    return res.status(400).json({ error: "items/metrics must be valid JSON" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array is required" });
  }
  items = cleanItems(items);

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const completionPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  let photoAiCheck = null;
  if (req.file) {
    photoAiCheck = await runAiPhotoCheck(req.file.path, req.file.mimetype);
  }

  const id = randomUUID();
  const workDate = todayISO();
  db.prepare(`
    INSERT INTO shift_checklist_submissions
      (id, user_id, role_name, shift, work_date, items_json, metrics_json, completed, total, completion_pct, photo_path, photo_live_timestamp, photo_ai_check, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'))
    ON CONFLICT(user_id, work_date, shift) DO UPDATE SET
      items_json = excluded.items_json, metrics_json = excluded.metrics_json,
      completed = excluded.completed, total = excluded.total, completion_pct = excluded.completion_pct,
      photo_path = COALESCE(excluded.photo_path, shift_checklist_submissions.photo_path),
      photo_live_timestamp = COALESCE(excluded.photo_live_timestamp, shift_checklist_submissions.photo_live_timestamp),
      photo_ai_check = COALESCE(excluded.photo_ai_check, shift_checklist_submissions.photo_ai_check),
      status = 'submitted', updated_at = datetime('now'), submitted_at = datetime('now')
  `).run(
    id, req.user.userId, user.shift_role, shift, workDate,
    JSON.stringify(items), metrics ? JSON.stringify(metrics) : null,
    completed, total, completionPct,
    req.file ? req.file.path : null, photoLiveTimestamp || null, photoAiCheck
  );

  const row = db.prepare(`SELECT * FROM shift_checklist_submissions WHERE user_id = ? AND work_date = ? AND shift = ?`)
    .get(req.user.userId, workDate, shift);
  res.json(serializeSubmission(row));
});

// GET /api/shift-checklist/submissions — admin/manager view across staff.
// query: date (YYYY-MM-DD, default today), shift, roleName
router.get("/submissions", requireAuth, requirePermission("shiftchecklist:view_all"), (req, res) => {
  const date = req.query.date || todayISO();
  const clauses = ["s.work_date = ?"];
  const params = [date];
  if (req.query.shift) { clauses.push("s.shift = ?"); params.push(req.query.shift); }
  if (req.query.roleName) { clauses.push("s.role_name = ?"); params.push(req.query.roleName); }

  const rows = db.prepare(`
    SELECT s.*, u.name AS staff_name, u.department_id
    FROM shift_checklist_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY CASE s.status WHEN 'in_progress' THEN 0 ELSE 1 END, s.role_name
  `).all(...params);

  // Also report who HASN'T submitted yet today, so admins see gaps, not just what came in.
  const expected = db.prepare(`SELECT id, name, shift_role FROM users WHERE shift_role IS NOT NULL AND active = 1`).all();
  const startedUserIds = new Set(rows.map((r) => r.user_id));
  const missing = expected.filter((u) => !startedUserIds.has(u.id)).map((u) => ({ userId: u.id, name: u.name, roleName: u.shift_role }));

  res.json({ date, submissions: rows.map(serializeSubmission), missing });
});

// ---------------------------------------------------------------------------
// History import: bring in the CSV exported from the old Google Sheet / Apps
// Script so past submissions show up in the app's dashboards.
// POST /api/shift-checklist/import  (admin, multipart: file, mapping?, dryRun?)
// mapping = JSON { "Name in sheet": "userId" }.  Existing app entries are never overwritten.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z]/g, "");

/** Reads the checklist log (CSV text) into the app. Entries filled in the app are never overwritten; sheet entries keep the latest. */
export function importChecklistCsv(text, { mapping = {}, dryRun = false } = {}) {
  const table = parseCsv(String(text).replace(/^\uFEFF/, ""));
  const head = table.shift() || [];
  const col = (n) => head.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const ix = { at: col("Submitted At"), name: col("Staff Name"), role: col("Role"), date: col("Date"), shift: col("Shift"), done: col("Completed"), total: col("Total"), detail: col("Checklist Detail"), metrics: col("Metrics") };
  if (ix.name < 0 || ix.date < 0 || ix.detail < 0) { const e = new Error("This does not look like the checklist log (needs Staff Name, Date and Checklist Detail columns)."); e.status = 400; throw e; }

  const users = db.prepare("SELECT id, name FROM users WHERE active = 1").all();
  const resolve = (sheetName) => {
    if (mapping[sheetName] === "skip") return null;
    if (mapping[sheetName]) return users.find((u) => u.id === mapping[sheetName]) || null;
    const n = norm(sheetName);
    return users.find((u) => norm(u.name) === n) || users.find((u) => norm(u.name.split(" ")[0]) === n)
      || users.find((u) => n.length > 4 && editDistance(norm(u.name.split(" ")[0]), n) <= 2) || null;  // tolerates spelling slips like Prathyusha / Pratyusha
  };

  // Keep only the LATEST submission for each person + date + shift.
  const latest = new Map();
  for (const r of table) {
    const key = `${norm(r[ix.name])}|${r[ix.date]}|${r[ix.shift]}`;
    const [d, m, rest] = (r[ix.at] || "").split(/[\/ ]/);
    const stamp = r[ix.at] ? `${(rest || "")}-${m}-${d}` + (r[ix.at].split(" ")[1] || "") : "";
    const prev = latest.get(key);
    if (!prev || stamp >= prev.stamp) latest.set(key, { r, stamp });
  }

  const unmatched = new Map(); let imported = 0, existing = 0;
  const insert = db.prepare(`INSERT INTO shift_checklist_submissions
    (id, user_id, role_name, shift, work_date, items_json, metrics_json, completed, total, completion_pct, status, submitted_at, updated_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, 'sheet')
    ON CONFLICT(user_id, work_date, shift) DO UPDATE SET
      items_json = excluded.items_json, metrics_json = excluded.metrics_json, completed = excluded.completed, total = excluded.total,
      completion_pct = excluded.completion_pct, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at
    WHERE shift_checklist_submissions.source = 'sheet' AND excluded.completed != shift_checklist_submissions.completed`);
  const run = db.transaction(() => {
    for (const { r } of latest.values()) {
      const sheetName = (r[ix.name] || "").trim();
      const u = resolve(sheetName);
      if (!u) { unmatched.set(sheetName, (unmatched.get(sheetName) || 0) + 1); continue; }
      const items = []; let section = "";
      for (const line of (r[ix.detail] || "").split("\n")) {
        const m = line.match(/^\s*\[(DONE|PENDING)\]\s*(.*)$/i);
        if (m) items.push({ section, text: m[2].trim(), done: m[1].toUpperCase() === "DONE" });
        else if (line.trim().endsWith(":")) section = line.trim().slice(0, -1);
      }
      if (!items.length) continue;
      const metrics = {};
      for (const part of (ix.metrics >= 0 ? r[ix.metrics] || "" : "").split(";")) {
        const k = part.slice(0, part.indexOf(":")).trim(), v = part.slice(part.indexOf(":") + 1).trim();
        if (k && v && v !== "-") metrics[k] = v;
      }
      const completed = items.filter((i) => i.done).length;
      const [dd, mm, rest] = (r[ix.at] || "").split(/[\/ ]/);
      const when = r[ix.at] && rest ? `${rest}-${mm}-${dd} ${r[ix.at].split(" ")[1] || "00:00:00"}` : null;
      if (!dryRun) {
        const info = insert.run(randomUUID(), u.id, (r[ix.role] || "").trim() || "Imported", r[ix.shift] || "Morning", r[ix.date],
          JSON.stringify(items), Object.keys(metrics).length ? JSON.stringify(metrics) : null, completed, items.length,
          Math.round((completed / items.length) * 100), when || new Date().toISOString().replace("T", " ").slice(0, 19), when);
        if (info.changes) imported++; else existing++;
      } else imported++;
    }
  });
  run();
  return { dryRun, rowsInFile: table.length, uniqueEntries: latest.size, imported, alreadyInApp: existing, unmatched: [...unmatched].map(([name, count]) => ({ name, count })), staff: users };
}

router.post("/import", requireAuth, importUpload.single("file"), (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  if (!req.file) return res.status(400).json({ error: "Choose the CSV file exported from the Google Sheet" });
  let mapping = {};
  try { mapping = JSON.parse(req.body?.mapping || "{}"); } catch {}
  try {
    const dry = !!req.body?.dryRun && req.body.dryRun !== "false";
    if (!dry && Object.keys(mapping).length) putSetting("checklist_name_map", JSON.stringify({ ...JSON.parse(getSetting("checklist_name_map") || "{}"), ...mapping }));
    res.json(importChecklistCsv(req.file.buffer.toString("utf8"), { mapping, dryRun: dry }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Live link to the old Google Sheet: the app reads the sheet's "published CSV" address every 10 minutes (and on demand),
// so checklists filled through the old form and checklists filled in the app show together in ONE dashboard.
// ---------------------------------------------------------------------------
// Accepts the ordinary Google Sheets link people copy from the address bar (…/spreadsheets/d/ID/edit#gid=123)
// as well as a "Publish to web" CSV link, and turns it into the CSV download address.
export function normalizeSheetUrl(u) {
  const url = String(u || "").trim();
  const m = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?!\/e\/)/.exec(url);
  if (!m || /\/d\/e\//.test(url) || /output=csv|format=csv/.test(url)) return url;
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1] || "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}
export async function syncChecklistSheet() {
  const url = normalizeSheetUrl(getSetting("checklist_sheet_csv"));
  if (!url) return { skipped: "No sheet link saved yet" };
  const set = (o) => putSetting("checklist_sync_status", JSON.stringify({ at: new Date().toISOString(), ...o }));
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`The sheet link answered with an error (${r.status}). The sheet is probably private: in Google Sheets press Share → General access → “Anyone with the link” → Viewer (or use File → Share → Publish to web).`);
    if (/<html/i.test(text.slice(0, 500))) throw new Error("Google asked for a sign-in, so the sheet is private. In Google Sheets press Share → General access → “Anyone with the link” → Viewer, then press Sync again. (Or use File → Share → Publish to web → CSV.)");
    const out = importChecklistCsv(text, { mapping: JSON.parse(getSetting("checklist_name_map") || "{}") });
    set({ ok: true, imported: out.imported, unmatched: out.unmatched.length, rows: out.rowsInFile });
    return { ok: true, ...out };
  } catch (e) { set({ ok: false, error: e.message }); return { ok: false, error: e.message }; }
}
router.get("/sheet", requireAuth, requirePermission("shiftchecklist:view_all"), (req, res) => {
  let status = null; try { status = JSON.parse(getSetting("checklist_sync_status") || "null"); } catch {}
  res.json({ url: req.user.roleName === "admin" ? getSetting("checklist_sheet_csv") : (getSetting("checklist_sheet_csv") ? "set" : ""), status });
});
router.put("/sheet", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const url = String(req.body?.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "The link must start with https://" });
  putSetting("checklist_sheet_csv", url); res.json({ ok: true, csv: normalizeSheetUrl(url) });
});
router.post("/sheet/sync", requireAuth, async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const r = await syncChecklistSheet();
  if (r.skipped) return res.status(400).json({ error: r.skipped });
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true, imported: r.imported, unmatched: r.unmatched, rows: r.rowsInFile });
});

// ---------------------------------------------------------------------------
// ONE dashboard: app submissions + sheet submissions together.
// ---------------------------------------------------------------------------
router.get("/dashboard", requireAuth, requirePermission("shiftchecklist:view_all"), (req, res) => {
  const today = todayISO();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : today;
  const days = Math.min(Math.max(Number(req.query.days) || 14, 3), 60);
  const since = new Date(new Date(date).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT s.*, u.name AS staff_name FROM shift_checklist_submissions s JOIN users u ON u.id = s.user_id WHERE s.work_date BETWEEN ? AND ?`).all(since, date);
  const dayRows = rows.filter((r) => r.work_date === date);
  const photosIn = (r) => JSON.parse(r.items_json).filter((i) => i.photoUrl).length + (r.photo_path ? 1 : 0);
  const expected = db.prepare("SELECT id, name, shift_role FROM users WHERE shift_role IS NOT NULL AND active = 1").all();
  const started = new Set(dayRows.map((r) => r.user_id));
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(new Date(date).getTime() - i * 86400000).toISOString().slice(0, 10);
    const rs = rows.filter((r) => r.work_date === d);   // submitted AND still-being-filled, so the chart moves as staff tick items
    trend.push({ date: d, submitted: rs.filter((r) => r.status === "submitted").length, started: rs.length, avgPct: avg(rs.map((r) => r.completion_pct)) });
  }
  const byRole = {};
  for (const r of rows) (byRole[r.role_name] ||= []).push(r.completion_pct);
  const missedCount = new Map();
  for (const r of rows.filter((x) => x.status === "submitted" || x.work_date < date)) for (const i of JSON.parse(r.items_json)) if (!i.done) { const k = `${r.role_name}|||${i.text}`; missedCount.set(k, (missedCount.get(k) || 0) + 1); }
  res.json({
    date, today,
    summary: {
      expected: expected.length, submitted: dayRows.filter((r) => r.status === "submitted").length, inProgress: dayRows.filter((r) => r.status === "in_progress").length,
      notStarted: expected.filter((u) => !started.has(u.id)).length, avgPct: avg(dayRows.map((r) => r.completion_pct)),
      photos: dayRows.reduce((n, r) => n + photosIn(r), 0), fromSheet: dayRows.filter((r) => r.source === "sheet").length, fromApp: dayRows.filter((r) => r.source !== "sheet").length,
    },
    trend,
    byRole: Object.entries(byRole).map(([role, v]) => ({ role, avgPct: avg(v), submissions: v.length })).sort((a, b) => a.avgPct - b.avgPct),
    missedMost: [...missedCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ role: k.split("|||")[0], task: k.split("|||")[1], times: n })),
    people: dayRows.map((r) => ({ ...serializeSubmission(r), source: r.source || "app", photos: photosIn(r) })).sort((a, b) => a.staffName.localeCompare(b.staffName)),
    missing: expected.filter((u) => !started.has(u.id)).map((u) => ({ userId: u.id, name: u.name, roleName: u.shift_role })),
  });
});

export default router;
