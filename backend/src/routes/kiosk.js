// Face check-in on the clinic phone ("kiosk"). Staff look at the camera; the app recognises them and marks them present.
// Matching happens on the server against saved face prints (128 numbers each, not photos). The kiosk phone holds only a
// limited kiosk key, which cannot open anything else in the app.
import { Router } from "express";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { MARKS } from "./attendance.js"; // also makes sure the attendance_marks table exists
import { lanAddresses, HTTPS_PORT, httpsRunning } from "../https.js";

const router = Router();
const DATA = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNAP_DIR = path.join(DATA, "private", "checkin-snaps");
fs.mkdirSync(SNAP_DIR, { recursive: true });
const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE || 0.5); // lower = stricter
const UNIQUE_DISTANCE = Number(process.env.FACE_UNIQUE_DISTANCE || 0.45); // two people closer than this are treated as the same face
const MIN_GAP_MIN = Number(process.env.MIN_STAY_MINUTES || 30);        // a second look within this many minutes is not a logout
const LATE_AFTER = process.env.LATE_AFTER || "10:30";                   // IST, HH:MM — arrivals after this are marked Late
const secret = () => process.env.JWT_SECRET;
const istNow = () => new Date(Date.now() + 19800000);
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const okDesc = (d) => Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === "number" && Number.isFinite(x));

function requireKiosk(req, res, next) {
  const h = req.headers.authorization || "";
  try {
    const p = jwt.verify(h.startsWith("Bearer ") ? h.slice(7) : "", secret());
    if (p.kind !== "kiosk") throw new Error("not a kiosk key");
    const dev = db.prepare("SELECT * FROM kiosk_devices WHERE id = ? AND revoked_at IS NULL").get(p.deviceId);
    if (!dev) return res.status(401).json({ error: "This clinic phone has been switched off by the admin" });
    db.prepare("UPDATE kiosk_devices SET last_seen = datetime('now') WHERE id = ?").run(dev.id);
    req.kiosk = dev; next();
  } catch { res.status(401).json({ error: "This phone is not set up for check-in. Ask the admin for a new link." }); }
}

// ---- admin side ----------------------------------------------------------
// Is this face already registered to somebody else?  Returns { name } of the other person, or null.
function otherOwnerOfFace(list, exceptUserId) {
  for (const t of db.prepare("SELECT t.user_id, t.descriptors, u.name FROM face_templates t JOIN users u ON u.id = t.user_id WHERE u.active = 1 AND t.user_id != ?").all(exceptUserId || "")) {
    const theirs = JSON.parse(t.descriptors);
    let hits = 0;
    for (const d of list) if (theirs.some((x) => dist(d, x) <= UNIQUE_DISTANCE)) hits++;
    if (hits >= Math.max(1, Math.ceil(list.length / 2))) return { userId: t.user_id, name: t.name };
  }
  return null;
}
router.get("/enrolled", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const rows = db.prepare("SELECT t.user_id, t.enrolled_at, t.descriptors FROM face_templates t JOIN users u ON u.id = t.user_id WHERE u.active = 1").all();
  res.json(rows.map((r) => {
    const dup = otherOwnerOfFace(JSON.parse(r.descriptors), r.user_id);
    return { user_id: r.user_id, enrolled_at: r.enrolled_at, samples: JSON.parse(r.descriptors).length, same_as: dup?.name || null };
  }));
});
// Used while adding staff, before saving: is this face already registered?
router.post("/check-duplicate", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const list = (req.body?.descriptors || []).filter(okDesc).slice(0, 8);
  if (!list.length) return res.status(400).json({ error: "No clear face" });
  const dup = otherOwnerOfFace(list, req.body?.exceptUserId);
  res.json({ duplicate: !!dup, name: dup?.name || null });
});
router.post("/enroll/:userId", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const list = (req.body?.descriptors || []).filter(okDesc).slice(0, 8);
  if (list.length < 3) return res.status(400).json({ error: "Not enough clear face samples. Try again in good light, looking at the camera." });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(req.params.userId)) return res.status(404).json({ error: "Staff member not found" });
  const dup = otherOwnerOfFace(list, req.params.userId);
  if (dup) return res.status(409).json({ error: `This face is already registered to ${dup.name}. One face can belong to only one person.` });
  db.prepare(`INSERT INTO face_templates (user_id, descriptors, enrolled_by) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET descriptors = excluded.descriptors, enrolled_by = excluded.enrolled_by, enrolled_at = datetime('now')`)
    .run(req.params.userId, JSON.stringify(list), req.user.userId);
  res.json({ ok: true, samples: list.length });
});
router.delete("/enroll/:userId", requireAuth, requirePermission("staff:manage"), (req, res) => {
  db.prepare("DELETE FROM face_templates WHERE user_id = ?").run(req.params.userId); res.json({ ok: true });
});
// Addresses a phone on the clinic Wi-Fi can use to reach this computer (a phone's "localhost" is the phone itself).
router.get("/lan", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const port = process.env.PORT || 4000;
  res.json({ addresses: lanAddresses(), httpPort: Number(port), httpsPort: httpsRunning ? HTTPS_PORT : null });
});
router.get("/devices", requireAuth, requirePermission("staff:manage"), (req, res) => {
  res.json(db.prepare("SELECT id, label, created_at, last_seen, revoked_at FROM kiosk_devices ORDER BY created_at DESC").all());
});
router.post("/devices", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const id = randomUUID();
  const label = String(req.body?.label || "Clinic phone").slice(0, 40);
  db.prepare("INSERT INTO kiosk_devices (id, label, created_by) VALUES (?,?,?)").run(id, label, req.user.userId);
  res.status(201).json({ id, label, key: jwt.sign({ kind: "kiosk", deviceId: id }, secret(), { expiresIn: "365d" }) });
});
router.delete("/devices/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  db.prepare("UPDATE kiosk_devices SET revoked_at = datetime('now') WHERE id = ?").run(req.params.id); res.json({ ok: true });
});
// Who checked in by face today, with the picture taken at that moment (admin/manager only).
router.get("/log", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : istNow().toISOString().slice(0, 10);
  res.json(db.prepare(
    `SELECT f.id, u.name, f.mark, f.kind, f.distance, f.created_at, (f.snapshot_path IS NOT NULL) AS has_snap
     FROM face_checkins f JOIN users u ON u.id = f.user_id
     WHERE date(f.created_at,'+5 hours','+30 minutes') = ? ORDER BY f.created_at DESC`).all(date));
});
router.get("/snap/:id", (req, res, next) => { if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`; next(); },
  requireAuth, requirePermission("attendance:view_all"), (req, res) => {
    const r = db.prepare("SELECT snapshot_path FROM face_checkins WHERE id = ?").get(req.params.id);
    if (!r?.snapshot_path || !fs.existsSync(r.snapshot_path)) return res.status(404).json({ error: "Not found" });
    res.type("image/jpeg"); res.sendFile(r.snapshot_path);
  });

// ---- clinic phone side -----------------------------------------------------
router.get("/ping", requireKiosk, (req, res) => res.json({ ok: true, label: req.kiosk.label, enrolled: db.prepare("SELECT COUNT(*) n FROM face_templates").get().n }));

router.post("/checkin", requireKiosk, (req, res) => {
  const { descriptor, snapshot } = req.body || {};
  if (!okDesc(descriptor)) return res.status(400).json({ error: "No clear face seen" });
  const per = new Map(); // best distance per person
  for (const t of db.prepare("SELECT t.user_id, t.descriptors, u.name FROM face_templates t JOIN users u ON u.id = t.user_id WHERE u.active = 1").all()) {
    let d = Infinity;
    for (const x of JSON.parse(t.descriptors)) d = Math.min(d, dist(descriptor, x));
    per.set(t.user_id, { userId: t.user_id, name: t.name, distance: d });
  }
  const ranked = [...per.values()].sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best || best.distance > MATCH_DISTANCE) return res.json({ matched: false });
  // Two different people both fit: refuse rather than mark the wrong person.
  if (ranked[1] && ranked[1].distance <= MATCH_DISTANCE && ranked[1].distance - best.distance < 0.04) return res.json({ matched: false, ambiguous: true });

  const now = istNow(), date = now.toISOString().slice(0, 10), hhmm = now.toISOString().slice(11, 16);
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const row = db.prepare("SELECT status, in_time, out_time FROM attendance_marks WHERE user_id = ? AND mark_date = ?").get(best.userId, date);
  let kind, mark = row?.status, inTime = row?.in_time || null, outTime = row?.out_time || null, already = false;
  if (!row || !row.in_time) {
    kind = "in"; inTime = hhmm;
    if (!row || !["P", "L", "H"].includes(row.status)) mark = hhmm > LATE_AFTER ? "L" : "P";
    db.prepare(`INSERT INTO attendance_marks (user_id, mark_date, status, in_time, note, marked_by) VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(user_id, mark_date) DO UPDATE SET status = excluded.status, in_time = excluded.in_time, updated_at = datetime('now')`)
      .run(best.userId, date, mark, inTime, `Face check-in ${hhmm}`);
  } else if (mins(hhmm) - mins(outTime || inTime) >= MIN_GAP_MIN) {
    kind = "out"; outTime = hhmm;
    db.prepare("UPDATE attendance_marks SET out_time = ?, updated_at = datetime('now') WHERE user_id = ? AND mark_date = ?").run(outTime, best.userId, date);
  } else { kind = outTime ? "out" : "in"; already = true; }
  const worked = inTime && outTime ? mins(outTime) - mins(inTime) : null;
  if (!already) {
    let snapPath = null;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(snapshot || "");
    if (m && m[1].length < 400000) { snapPath = path.join(SNAP_DIR, `${randomUUID()}.jpg`); fs.writeFileSync(snapPath, Buffer.from(m[1], "base64")); }
    db.prepare("INSERT INTO face_checkins (id, user_id, device_id, distance, mark, kind, snapshot_path) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), best.userId, req.kiosk.id, best.distance, mark, kind, snapPath);
  }
  res.json({ matched: true, name: best.name, kind, mark, label: MARKS[mark], time: kind === "out" ? outTime : inTime, inTime, outTime, workedMinutes: worked, already });
});

export default router;
