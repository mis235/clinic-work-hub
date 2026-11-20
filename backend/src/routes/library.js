// The document library: folders and files like a shared drive. Everyone signed in can open and download; only the admin changes it.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import PizZip from "pizzip";
import mammoth from "mammoth";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(process.env.DATA_DIR || path.join(HERE, "..", ".."), "private", "library");
const STAGE = path.join(LIB_DIR, ".incoming");
fs.mkdirSync(STAGE, { recursive: true });
const up = multer({ storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, STAGE), filename: (r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname || "").toLowerCase()}`) }), limits: { fileSize: 400 * 1024 * 1024 } });
const isAdmin = (req) => req.user?.roleName === "admin";
const adminOnly = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ error: "Only the admin can change the library" }));
const fixName = (n) => { try { return Buffer.from(n, "latin1").toString("utf8"); } catch { return n; } };
const norm = (n) => String(n || "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*|[^/]*\.tmp)(\/|$)/i;
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", doc: "application/msword", xls: "application/vnd.ms-excel", csv: "text/csv" };
const mimeFor = (name, fallback) => MIME[String(name).split(".").pop().toLowerCase()] || fallback || "application/octet-stream";

const folderRow = (id) => (id ? db.prepare("SELECT * FROM library_folders WHERE id = ?").get(id) : null);
const childFolder = (parent, name) => db.prepare("SELECT * FROM library_folders WHERE parent_id IS ? ").all(parent || null).find((f) => norm(f.name) === norm(name));
function makeFolder(parent, name) { const id = randomUUID(); db.prepare("INSERT INTO library_folders (id, parent_id, name) VALUES (?, ?, ?)").run(id, parent || null, name); return { id, parent_id: parent || null, name }; }
function crumbs(id) { const out = []; let f = folderRow(id); while (f) { out.unshift({ id: f.id, name: f.name }); f = folderRow(f.parent_id); } return out; }
function storeFile(folderId, name, tmpPath, size, userId, mime) {
  const dst = path.join(LIB_DIR, `${randomUUID()}${path.extname(name).toLowerCase()}`);
  fs.renameSync(tmpPath, dst);
  const old = db.prepare("SELECT id, file_path FROM library_files WHERE folder_id IS ? AND lower(name) = lower(?)").get(folderId || null, name);
  if (old) { fs.rmSync(old.file_path, { force: true }); db.prepare("UPDATE library_files SET file_path = ?, size = ?, mime = ?, updated_at = datetime('now') WHERE id = ?").run(dst, size, mimeFor(name, mime), old.id); return { id: old.id, replaced: true }; }
  const id = randomUUID();
  db.prepare("INSERT INTO library_files (id, folder_id, name, file_path, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, folderId || null, name, dst, mimeFor(name, mime), size, userId || null);
  return { id, replaced: false };
}

// First start: the folders the clinic already keeps in Google Drive, plus the two Word documents received by email.
try {
  if (!db.prepare("SELECT 1 FROM library_folders LIMIT 1").get()) {
    const ids = {};
    for (const n of ["Staff SOP", "Staff Checklist", "SOP New", "Policies", "Organisation Structure"]) ids[n] = makeFolder(null, n).id;
    for (const [folder, file] of [["Organisation Structure", "Organisation Structure.docx"], ["SOP New", "Front Office & Patient Experience Governance Manual v1.1.docx"]]) {
      const src = path.join(HERE, "..", "sop-files", file);
      if (!fs.existsSync(src)) continue;
      const tmp = path.join(STAGE, `${randomUUID()}.docx`); fs.copyFileSync(src, tmp);
      storeFile(ids[folder], file, tmp, fs.statSync(tmp).size, null);
    }
  }
} catch (e) { /* seeding is best effort */ }

router.get("/", requireAuth, (req, res) => {
  const fid = req.query.folder || null;
  if (fid && !folderRow(fid)) return res.status(404).json({ error: "Folder not found" });
  const folders = db.prepare(`SELECT f.id, f.name, f.created_at,
      (SELECT COUNT(*) FROM library_folders y WHERE y.parent_id = f.id) + (SELECT COUNT(*) FROM library_files x WHERE x.folder_id = f.id) AS items
    FROM library_folders f WHERE f.parent_id IS ?`).all(fid).sort((a, b) => natural(a.name, b.name));
  const files = db.prepare("SELECT f.id, f.name, f.size, f.mime, f.updated_at, u.name AS by FROM library_files f LEFT JOIN users u ON u.id = f.created_by WHERE f.folder_id IS ?").all(fid).sort((a, b) => natural(a.name, b.name));
  res.json({ path: crumbs(fid), folders, files, canManage: isAdmin(req) });
});

router.post("/folders", requireAuth, adminOnly, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 120), parent = req.body?.parentId || null;
  if (!name || /[\\/]/.test(name)) return res.status(400).json({ error: "Type a folder name (no slashes)." });
  if (parent && !folderRow(parent)) return res.status(404).json({ error: "Folder not found" });
  if (childFolder(parent, name)) return res.status(409).json({ error: "A folder with that name is already here." });
  res.status(201).json(makeFolder(parent, name));
});
router.patch("/folders/:id", requireAuth, adminOnly, (req, res) => {
  const f = folderRow(req.params.id), name = String(req.body?.name || "").trim().slice(0, 120);
  if (!f) return res.status(404).json({ error: "Folder not found" });
  if (!name || /[\\/]/.test(name)) return res.status(400).json({ error: "Type a folder name (no slashes)." });
  const dup = childFolder(f.parent_id, name); if (dup && dup.id !== f.id) return res.status(409).json({ error: "A folder with that name is already here." });
  db.prepare("UPDATE library_folders SET name = ? WHERE id = ?").run(name, f.id); res.json({ ok: true });
});
router.delete("/folders/:id", requireAuth, adminOnly, (req, res) => {
  if (!folderRow(req.params.id)) return res.status(404).json({ error: "Folder not found" });
  const all = [req.params.id]; for (let i = 0; i < all.length; i++) for (const c of db.prepare("SELECT id FROM library_folders WHERE parent_id = ?").all(all[i])) all.push(c.id);
  let n = 0;
  db.transaction(() => { for (const id of all) { for (const f of db.prepare("SELECT file_path FROM library_files WHERE folder_id = ?").all(id)) { fs.rmSync(f.file_path, { force: true }); n++; } db.prepare("DELETE FROM library_files WHERE folder_id = ?").run(id); } for (const id of all.reverse()) db.prepare("DELETE FROM library_folders WHERE id = ?").run(id); })();
  res.json({ ok: true, files: n });
});

router.post("/files", requireAuth, adminOnly, up.array("files", 100), (req, res) => {
  const fid = req.body?.folderId || null;
  const files = req.files || [];
  if (fid && !folderRow(fid)) { files.forEach((f) => fs.rmSync(f.path, { force: true })); return res.status(404).json({ error: "Folder not found" }); }
  if (!files.length) return res.status(400).json({ error: "Choose at least one file." });
  let added = 0, replaced = 0;
  for (const f of files) { const r = storeFile(fid, fixName(f.originalname), f.path, f.size, req.user.userId, f.mimetype); r.replaced ? replaced++ : added++; }
  res.status(201).json({ added, replaced });
});
router.patch("/files/:id", requireAuth, adminOnly, (req, res) => {
  const f = db.prepare("SELECT * FROM library_files WHERE id = ?").get(req.params.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  const name = req.body?.name == null ? f.name : String(req.body.name).trim().slice(0, 200);
  const folder = req.body?.folderId === undefined ? f.folder_id : (req.body.folderId || null);
  if (!name || /[\\/]/.test(name)) return res.status(400).json({ error: "Type a file name (no slashes)." });
  if (folder && !folderRow(folder)) return res.status(404).json({ error: "Folder not found" });
  const dup = db.prepare("SELECT id FROM library_files WHERE folder_id IS ? AND lower(name) = lower(?) AND id != ?").get(folder, name, f.id);
  if (dup) return res.status(409).json({ error: "A file with that name is already in that folder." });
  db.prepare("UPDATE library_files SET name = ?, folder_id = ?, mime = ? WHERE id = ?").run(name, folder, mimeFor(name, f.mime), f.id); res.json({ ok: true });
});
router.post("/files/:id/replace", requireAuth, adminOnly, up.single("file"), (req, res) => {
  const f = db.prepare("SELECT * FROM library_files WHERE id = ?").get(req.params.id);
  if (!f || !req.file) { if (req.file) fs.rmSync(req.file.path, { force: true }); return res.status(f ? 400 : 404).json({ error: f ? "Choose a file." : "File not found" }); }
  const dst = path.join(LIB_DIR, `${randomUUID()}${path.extname(req.file.originalname || f.name).toLowerCase()}`);
  fs.renameSync(req.file.path, dst); fs.rmSync(f.file_path, { force: true });
  db.prepare("UPDATE library_files SET file_path = ?, size = ?, mime = ?, updated_at = datetime('now') WHERE id = ?").run(dst, req.file.size, mimeFor(f.name, req.file.mimetype), f.id); res.json({ ok: true });
});
router.delete("/files/:id", requireAuth, adminOnly, (req, res) => {
  const f = db.prepare("SELECT * FROM library_files WHERE id = ?").get(req.params.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  fs.rmSync(f.file_path, { force: true }); db.prepare("DELETE FROM library_files WHERE id = ?").run(f.id); res.json({ ok: true });
});

router.get("/files/:id/download", requireAuth, (req, res) => {
  const f = db.prepare("SELECT * FROM library_files WHERE id = ?").get(req.params.id);
  if (!f || !fs.existsSync(f.file_path)) return res.status(404).json({ error: "File not found" });
  if (req.query.inline === "1" && /^(application\/pdf|image\/)/.test(f.mime || "")) { res.setHeader("Content-Type", f.mime); res.setHeader("Content-Disposition", "inline"); return res.sendFile(f.file_path); }
  res.download(f.file_path, f.name);
});
// Read a Word or text file on screen.
router.get("/files/:id/preview", requireAuth, async (req, res) => {
  const f = db.prepare("SELECT * FROM library_files WHERE id = ?").get(req.params.id);
  if (!f || !fs.existsSync(f.file_path)) return res.status(404).json({ error: "File not found" });
  try {
    if (/\.docx$/i.test(f.name)) { const r = await mammoth.convertToHtml({ path: f.file_path }); return res.json({ html: r.value }); }
    if (/\.(txt|csv|md)$/i.test(f.name)) return res.json({ text: fs.readFileSync(f.file_path, "utf8").slice(0, 200000) });
    res.status(415).json({ error: "This file type opens by download." });
  } catch { res.status(422).json({ error: "This file could not be shown on screen. Please download it." }); }
});

// Upload a whole folder as a .zip (for example a Google Drive folder downloaded to the computer); folders inside are kept.
router.post("/import", requireAuth, adminOnly, up.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose the .zip file." });
  const base = req.body?.folderId || null;
  let zip; try { zip = new PizZip(fs.readFileSync(req.file.path)); } catch { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: "That is not a readable .zip file." }); }
  fs.rmSync(req.file.path, { force: true });
  if (base && !folderRow(base)) return res.status(404).json({ error: "Folder not found" });
  const entries = Object.values(zip.files).filter((e) => !e.dir).map((e) => ({ e, parts: e.name.replace(/\\/g, "/").split("/").filter(Boolean) })).filter((x) => x.parts.length && !JUNK.test(x.parts.join("/")));
  if (entries.length > 5000) return res.status(400).json({ error: "That zip has too many files (limit 5000)." });
  const top = new Set(entries.map((x) => x.parts[0]));
  const strip = top.size === 1 && entries.every((x) => x.parts.length > 1) ? 1 : 0; // a zip with one wrapper folder: use what is inside it
  let files = 0, replaced = 0, folders = 0; const cache = new Map();
  const dirFor = (parts) => { let parent = base, key = ""; for (const n of parts) { key += "/" + norm(n); if (!cache.has(key)) { const hit = childFolder(parent, n); if (hit) cache.set(key, hit.id); else { cache.set(key, makeFolder(parent, n.slice(0, 120)).id); folders++; } } parent = cache.get(key); } return parent; };
  try {
    for (const { e, parts } of entries) {
      const rel = parts.slice(strip), name = rel[rel.length - 1].slice(0, 200); if (!name) continue;
      const buf = e.asNodeBuffer(), tmp = path.join(STAGE, `${randomUUID()}${path.extname(name).toLowerCase()}`); fs.writeFileSync(tmp, buf);
      const r = storeFile(dirFor(rel.slice(0, -1)), name, tmp, buf.length, req.user.userId, null); r.replaced ? replaced++ : files++;
    }
  } catch (err) { return res.status(500).json({ error: "Import stopped: " + err.message, files, folders }); }
  res.json({ files, replaced, folders });
});

export default router;
