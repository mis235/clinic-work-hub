// Daily database backup using SQLite's safe online-backup API (works while the app is running).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
export const backupDir = path.join(dataDir, "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 14);

export async function runBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `clinic-${stamp}.db`);
  await db.backup(file);
  // prune oldest
  const all = listBackups();
  for (const b of all.slice(KEEP)) fs.rmSync(path.join(backupDir, b.name), { force: true });
  return path.basename(file);
}

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"))
    .map((name) => { const s = fs.statSync(path.join(backupDir, name)); return { name, bytes: s.size, at: s.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
}
