// Backups: (1) a nightly safe copy of the database kept in the data folder, (2) an optional second copy placed in
// any folder the clinic chooses — e.g. a Google Drive / OneDrive / pen-drive folder — together with every uploaded file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
export const backupDir = path.join(dataDir, "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const COPY_KEEP = 14;
const BIG = ["private/videos", "private/checkin-snaps", "private/certs"]; // left out of the Drive copy unless "include big files" is on
const FILE_DIRS = ["uploads", "private", "payslips"];

db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
const get = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const put = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export const copyFolder = () => get("backup_copy_dir");
export const includeBig = () => get("backup_include_big") === "1";
export const setIncludeBig = (v) => put("backup_include_big", v ? "1" : "0");
export function copyStatus() { try { return JSON.parse(get("backup_copy_status") || "null"); } catch { return null; } }

/** Saves the folder after proving we can write to it. Empty string turns the extra copy off. */
export function setCopyFolder(dir) {
  dir = String(dir || "").trim().replace(/^"|"$/g, "");
  if (!dir) { put("backup_copy_dir", ""); return ""; }
  if (!path.isAbsolute(dir)) throw new Error("Type the full folder path, for example G:\\My Drive\\ClinicBackups");
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, ".write-test");
  fs.writeFileSync(probe, "ok"); fs.rmSync(probe);
  put("backup_copy_dir", dir);
  return dir;
}

function mirror(src, dst, skip = []) {           // copies new or changed files only (never deletes in the backup copy)
  let n = 0;
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (skip.some((k) => s.split(path.sep).join("/").endsWith(k))) continue;
    if (e.isDirectory()) n += mirror(s, d, skip);
    else { const a = fs.statSync(s); let b = null; try { b = fs.statSync(d); } catch {} if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs - 1000) { fs.copyFileSync(s, d); n++; } }
  }
  return n;
}

export function copyOffsite(dbFile) {
  const dir = copyFolder();
  if (!dir) return null;
  try {
    const dbDir = path.join(dir, "database");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.copyFileSync(dbFile, path.join(dbDir, path.basename(dbFile)));
    for (const old of fs.readdirSync(dbDir).filter((f) => f.endsWith(".db")).sort().reverse().slice(COPY_KEEP)) fs.rmSync(path.join(dbDir, old), { force: true });
    let files = 0;
    for (const d of FILE_DIRS) files += mirror(path.join(dataDir, d), path.join(dir, "files", d), includeBig() ? [] : BIG);
    const st = { ok: true, at: new Date().toISOString(), dir, files };
    put("backup_copy_status", JSON.stringify(st)); return st;
  } catch (e) {
    const st = { ok: false, at: new Date().toISOString(), dir, error: e.message };
    put("backup_copy_status", JSON.stringify(st)); return st;
  }
}

export async function runBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `clinic-${stamp}.db`);
  await db.backup(file);
  const all = listBackups();
  for (const b of all.slice(KEEP)) fs.rmSync(path.join(backupDir, b.name), { force: true });
  copyOffsite(file);
  return path.basename(file);
}

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"))
    .map((name) => { const s = fs.statSync(path.join(backupDir, name)); return { name, bytes: s.size, at: s.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
}

const sizeOf = (p) => { try { const s = fs.statSync(p); if (!s.isDirectory()) return s.size; return fs.readdirSync(p).reduce((t, f) => t + sizeOf(path.join(p, f)), 0); } catch { return 0; } };
export function storageReport() {
  const dbFile = path.join(dataDir, process.env.CLINIC_DB_FILE || "clinic.db");
  let free = null, total = null;
  try { const s = fs.statfsSync(dataDir); free = s.bavail * s.bsize; total = s.blocks * s.bsize; } catch {}
  const priv = path.join(dataDir, "private");
  const parts = [
    ["Database", sizeOf(dbFile) + sizeOf(dbFile + "-wal")], ["Backups", sizeOf(backupDir)], ["Checklist & task photos", sizeOf(path.join(dataDir, "uploads"))],
    ["Face check-in snapshots", sizeOf(path.join(priv, "checkin-snaps"))], ["Training videos", sizeOf(path.join(priv, "training")) + sizeOf(path.join(priv, "videos"))],
    ["Payslips", sizeOf(path.join(dataDir, "payslips"))],
  ];
  const known = parts.reduce((t, p) => t + p[1], 0);
  parts.push(["Other files (documents, photos, certificates)", Math.max(0, sizeOf(dataDir) - known - sizeOf(path.join(dataDir, "node_modules")))]);
  return { parts: parts.map(([name, bytes]) => ({ name, bytes })), free, total };
}

/** Deletes face check-in photos older than N days (the attendance records stay). */
export function cleanSnapshots(days) {
  const rows = db.prepare("SELECT id, snapshot_path FROM face_checkins WHERE snapshot_path IS NOT NULL AND created_at < datetime('now', ?)").all(`-${Number(days)} days`);
  let bytes = 0;
  for (const r of rows) { try { bytes += fs.statSync(r.snapshot_path).size; fs.rmSync(r.snapshot_path, { force: true }); } catch {} db.prepare("UPDATE face_checkins SET snapshot_path = NULL WHERE id = ?").run(r.id); }
  return { removed: rows.length, bytes };
}
