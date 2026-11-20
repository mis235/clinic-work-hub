// One-time (or repeatable) import of the clinic's "Staff data" folders (as a .zip): sorted onto each person and document type.
// Step 1 (preview): the zip is read and every file gets a proposed person + type. Step 2 (commit): the admin's choices are saved.
// Files go to the PRIVATE folder and are only served through the authenticated routes (a person sees only their own).
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import PizZip from "pizzip";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { DOC_DIR, GEN_DIR } from "./documents.js";
import { DOC_CHECKLIST } from "./users.js";
import { classify, matchPerson, typeLabel, RECORD_TYPES, mimeFor } from "../staffFiles.js";

const router = Router();
const STAGE = path.join(path.dirname(DOC_DIR), "import-staging");
fs.mkdirSync(STAGE, { recursive: true });
for (const f of fs.readdirSync(STAGE)) { try { if (Date.now() - fs.statSync(path.join(STAGE, f)).mtimeMs > 24 * 3600 * 1000) fs.rmSync(path.join(STAGE, f), { force: true }); } catch {} }
const adminOnly = (req, res, next) => (req.user?.roleName === "admin" ? next() : res.status(403).json({ error: "Admin only" }));
const upload = multer({ storage: multer.diskStorage({ destination: STAGE, filename: (req, file, cb) => cb(null, `${randomUUID()}.zip`) }), limits: { fileSize: 400 * 1024 * 1024 } });
const fixName = (n) => { try { return Buffer.from(n, "latin1").toString("utf8"); } catch { return n; } };

const people = () => db.prepare("SELECT u.id, u.name, u.designation, u.active, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.active DESC, u.name").all();
const allTypes = () => [...DOC_CHECKLIST.map((t) => ({ key: t.key, label: t.label })), ...RECORD_TYPES];
const zipEntries = (zip) => Object.keys(zip.files).filter((k) => !zip.files[k].dir);

router.post("/preview", requireAuth, adminOnly, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose the .zip file." });
  let zip; try { zip = new PizZip(fs.readFileSync(req.file.path)); } catch { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: "That is not a readable .zip file." }); }
  const users = people(), names = zipEntries(zip), items = [];
  const existing = new Set(db.prepare("SELECT staff_user_id AS u, file_name AS f, size FROM documents WHERE staff_user_id IS NOT NULL").all().map((r) => `${r.u}|${r.f}|${r.size}`));
  names.forEach((zp, i) => {
    const c = classify(zp), file = zp.split("/").pop();
    const size = zip.files[zp]._data?.uncompressedSize ?? 0;
    if (c.skip) { items.push({ i, file, size, skip: true, reason: c.reason }); return; }
    const m = matchPerson(c.person, users, c.hintDoctor);
    items.push({ i, file, size, path: zp.split("/").slice(-3, -1).join(" / "), type: c.type, person: c.person, dept: c.dept, userId: m.userId, candidates: m.candidates.slice(0, 6), dup: !!(m.userId && existing.has(`${m.userId}|${file}|${size}`)) });
  });
  res.json({ stagingId: path.basename(req.file.filename, ".zip"), items, users, types: allTypes() });
});

router.post("/commit", requireAuth, adminOnly, (req, res) => {
  const { stagingId, items } = req.body || {};
  if (!/^[0-9a-f-]{36}$/.test(stagingId || "") || !Array.isArray(items)) return res.status(400).json({ error: "Nothing to import." });
  const zp = path.join(STAGE, `${stagingId}.zip`);
  if (!fs.existsSync(zp)) return res.status(404).json({ error: "The uploaded file has expired. Please upload the zip again." });
  const zip = new PizZip(fs.readFileSync(zp)), names = zipEntries(zip);
  const checklist = new Set(DOC_CHECKLIST.map((t) => t.key)), valid = new Set(allTypes().map((t) => t.key));
  const done = { imported: 0, offer: 0, skipped: 0, duplicates: 0 };
  const findUser = db.prepare("SELECT id, department_id, onboarding_docs FROM users WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const it of items) {
      const name = names[it.i], u = it.userId ? findUser.get(it.userId) : null;
      if (!name || !u || !valid.has(it.type)) { done.skipped++; continue; }
      const file = fixName(name.split("/").pop()), buf = zip.file(name).asNodeBuffer();
      const dupe = db.prepare("SELECT 1 FROM documents WHERE staff_user_id = ? AND file_name = ? AND size = ?").get(u.id, file, buf.length)
        || (it.type === "offer_letter" && db.prepare("SELECT 1 FROM generated_docs WHERE user_id = ? AND kind = 'offer_letter' AND file_name = ?").get(u.id, file));
      if (dupe) { done.duplicates++; continue; }
      const id = randomUUID(), ext = path.extname(file).toLowerCase();
      if (it.type === "offer_letter") { // offer letters live with the generated ones: they show in HR → Offer Letters (by department) and in "My offer letter"
        const fp = path.join(GEN_DIR, `${id}${ext}`); fs.writeFileSync(fp, buf);
        db.prepare("INSERT INTO generated_docs (id, template_id, kind, user_id, company_id, period, file_path, file_name, created_by) VALUES (?, NULL, 'offer_letter', ?, NULL, NULL, ?, ?, ?)").run(id, u.id, fp, file, req.user.userId);
        done.offer++;
      } else {
        const fp = path.join(DOC_DIR, `${id}${ext}`); fs.writeFileSync(fp, buf);
        db.prepare("INSERT INTO documents (id, department_id, title, category, kind, file_path, file_name, mime, size, uploaded_by, staff_user_id, doc_type) VALUES (?, ?, ?, 'Staff file', 'file', ?, ?, ?, ?, ?, ?, ?)")
          .run(id, u.department_id, typeLabel(it.type), fp, file, mimeFor(file), buf.length, req.user.userId, u.id, it.type);
        if (checklist.has(it.type)) { const merged = { ...(u.onboarding_docs ? JSON.parse(u.onboarding_docs) : {}), [it.type]: true }; db.prepare("UPDATE users SET onboarding_docs = ? WHERE id = ?").run(JSON.stringify(merged), u.id); }
        done.imported++;
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); return res.status(500).json({ error: "Import stopped, nothing was saved: " + e.message }); }
  fs.rmSync(zp, { force: true });
  res.json(done);
});

router.delete("/:id", requireAuth, adminOnly, (req, res) => { if (/^[0-9a-f-]{36}$/.test(req.params.id)) fs.rmSync(path.join(STAGE, `${req.params.id}.zip`), { force: true }); res.json({ ok: true }); });
export default router;
