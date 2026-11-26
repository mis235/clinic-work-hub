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
const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE || 0.42); // lower = stricter (0.5 let look-alike colleagues through)
const MATCH_MARGIN = Number(process.env.FACE_MATCH_MARGIN || 0.08); // the best person must beat the next person by at least this much
const UNIQUE_DISTANCE = Number(process.env.FACE_UNIQUE_DISTANCE || 0.45); // two people closer than this are treated as the same face
const MIN_GAP_MIN = Number(process.env.MIN_STAY_MINUTES || 60);        // a second look within this many minutes is not a logout
import { isLateArrival, syncLateFines, shiftWindow, dayStatus } from "./leave.js";
import { queueSheet } from "../attendanceSheet.js";
import { engage } from "../engage.js";
// Late = more than the grace minutes (HR rule, default 15) after the start of the person's shift.                   // IST, HH:MM — arrivals after this are marked Late
const secret = () => process.env.JWT_SECRET;
const istNow = () => new Date(Date.now() + 19800000);
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const okDesc = (d) => Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === "number" && Number.isFinite(x));

// Face check-in is for the clinic phone only: a computer or laptop opening the same link is refused.
const isPhone = (req) => /Android|iPhone|iPad|iPod|Mobile/i.test(req.headers["user-agent"] || "");
function phoneLabel(ua = "") {
  const dev = /iPad/i.test(ua) ? "iPad" : /iPhone|iPod/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android phone" : "Phone";
  const br = /CriOS|Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : "";
  return br ? `${dev} · ${br}` : dev;
}
function requireKiosk(req, res, next) {
  if (!isPhone(req) && process.env.KIOSK_ALLOW_DESKTOP !== "true") return res.status(403).json({ error: "Face check-in works only on the clinic phone. Please use the phone.", phoneOnly: true });
  const h = req.headers.authorization || "";
  try {
    const p = jwt.verify(h.startsWith("Bearer ") ? h.slice(7) : "", secret());
    if (p.kind !== "kiosk") throw new Error("not a kiosk key");
    const dev = db.prepare("SELECT * FROM kiosk_devices WHERE id = ? AND revoked_at IS NULL").get(p.deviceId);
    if (!dev) return res.status(401).json({ error: "This clinic phone has been switched off by the admin" });
    // One shared link can run on many phones: each phone gets its own id (kept in the phone) so it can be tracked and switched off alone.
    const pid = String(req.headers["x-phone-id"] || "").replace(/[^\w-]/g, "").slice(0, 40);
    if (pid.length >= 8) {
      const ph = db.prepare("SELECT blocked_at FROM kiosk_phones WHERE id = ?").get(pid);
      if (ph?.blocked_at) return res.status(401).json({ error: "This phone has been switched off by the admin" });
      if (ph) db.prepare("UPDATE kiosk_phones SET last_seen = datetime('now'), device_id = ? WHERE id = ?").run(dev.id, pid);
      else db.prepare("INSERT INTO kiosk_phones (id, device_id, label, last_seen) VALUES (?,?,?,datetime('now'))").run(pid, dev.id, phoneLabel(req.headers["user-agent"]));
      req.phoneId = pid;
    }
    db.prepare("UPDATE kiosk_devices SET last_seen = datetime('now') WHERE id = ?").run(dev.id);
    req.kiosk = dev; next();
  } catch { res.status(401).json({ error: "This phone is not set up for check-in. Ask the admin for a new link." }); }
}

// ---- admin side ----------------------------------------------------------
// Is this face already registered to somebody else?  Returns { name } of the other person, or null.
function otherOwnerOfFace(list, exceptUserId) {
  for (const t of db.prepare("SELECT t.user_id, t.descriptors, u.name FROM face_templates t JOIN users u ON u.id = t.user_id WHERE u.active = 1 AND t.user_id != ?").all(exceptUserId || "")) {
    const theirs = JSON.parse(t.descriptors);
    // Looked at from both sides: a poor saved face (all samples bunched together) can sit close to a good one even when the good one does not look close to it.
    let hits = 0, back = 0;
    for (const d of list) if (theirs.some((x) => dist(d, x) <= UNIQUE_DISTANCE)) hits++;
    for (const x of theirs) if (list.some((d) => dist(d, x) <= UNIQUE_DISTANCE)) back++;
    if (hits >= Math.max(1, Math.ceil(list.length / 2)) || back >= Math.max(1, Math.ceil(theirs.length / 2))) {
      // How close, in the scanner's own measure: the median of each sample's nearest saved sample, taken from the side that matched.
      const side = hits >= back ? list.map((d) => Math.min(...theirs.map((x) => dist(d, x)))) : theirs.map((x) => Math.min(...list.map((d) => dist(d, x))));
      const near = side.sort((x, y) => x - y);
      return { userId: t.user_id, name: t.name, distance: Math.round(near[Math.floor(near.length / 2)] * 100) / 100 };
    }
  }
  return null;
}
const SAME_PERSON = Number(process.env.FACE_SAME_PERSON || 0.3); // closer than this: never allowed to save as two people
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
  // All samples must be the same face: a wide spread means two people, or junk pictures, were mixed in.
  let spread = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) spread = Math.max(spread, dist(list[i], list[j]));
  if (spread > 0.7) return res.status(400).json({ error: "The pictures were not all of the same face. Only the person being registered should be in front of the camera. Please try again." });
  const dup = otherOwnerOfFace(list, req.params.userId);
  // The admin may confirm "these are two different people" (force), unless the faces are so close they are surely the same person.
  if (dup && !(req.body?.force === true && dup.distance >= SAME_PERSON)) {
    return res.status(409).json({
      error: `This face looks the same as ${dup.name}'s saved face (closeness ${dup.distance}; the same person is usually 0.40 or less).`,
      similar: { userId: dup.userId, name: dup.name, distance: dup.distance, canForce: dup.distance >= SAME_PERSON },
    });
  }
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
  let tunnelUrl = null;
  try { tunnelUrl = fs.readFileSync(path.join(DATA, "tunnel-url.txt"), "utf8").trim() || null; } catch {}
  res.json({ addresses: lanAddresses(), httpPort: Number(port), httpsPort: httpsRunning ? HTTPS_PORT : null, tunnelUrl });
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
// ONE link for every clinic phone: the same key is reused, so nobody ever needs a new link.
const SHARED_LABEL = "Clinic check-in link (all phones)";
router.get("/shared-link", requireAuth, requirePermission("staff:manage"), (req, res) => {
  let d = db.prepare("SELECT id FROM kiosk_devices WHERE label = ? AND revoked_at IS NULL ORDER BY created_at LIMIT 1").get(SHARED_LABEL);
  if (!d) { const id = randomUUID(); db.prepare("INSERT INTO kiosk_devices (id, label, created_by) VALUES (?,?,?)").run(id, SHARED_LABEL, req.user.userId); d = { id }; }
  res.json({ id: d.id, key: jwt.sign({ kind: "kiosk", deviceId: d.id }, secret(), { expiresIn: "3650d" }) });
});
// Every phone that has opened the link, with today's check-ins.
router.get("/phones", requireAuth, requirePermission("staff:manage"), (req, res) => {
  res.json(db.prepare(`SELECT p.id, p.label, p.first_seen, p.last_seen, p.blocked_at,
      (SELECT COUNT(*) FROM face_checkins f WHERE f.phone_id = p.id AND f.undone_at IS NULL AND date(f.created_at,'+5 hours','+30 minutes') = ?) AS today
    FROM kiosk_phones p ORDER BY p.last_seen DESC`).all(istNow().toISOString().slice(0, 10)));
});
router.put("/phones/:id", requireAuth, requirePermission("staff:manage"), (req, res) => {
  if (req.body?.label !== undefined) db.prepare("UPDATE kiosk_phones SET label = ? WHERE id = ?").run(String(req.body.label).slice(0, 40), req.params.id);
  if (req.body?.blocked !== undefined) db.prepare("UPDATE kiosk_phones SET blocked_at = ? WHERE id = ?").run(req.body.blocked ? new Date().toISOString() : null, req.params.id);
  res.json({ ok: true });
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
     WHERE date(f.created_at,'+5 hours','+30 minutes') = ? AND f.undone_at IS NULL ORDER BY f.created_at DESC`).all(date));
});
router.get("/snap/:id", (req, res, next) => { if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`; next(); },
  requireAuth, requirePermission("attendance:view_all"), (req, res) => {
    const r = db.prepare("SELECT snapshot_path FROM face_checkins WHERE id = ?").get(req.params.id);
    if (!r?.snapshot_path || !fs.existsSync(r.snapshot_path)) return res.status(404).json({ error: "Not found" });
    res.type("image/jpeg"); res.sendFile(r.snapshot_path);
  });

// ---- clinic phone side -----------------------------------------------------
// ---- clinic location: check-in works only at the clinic ---------------------
const setting = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value;
function geoCfg() { // one or more clinic places (e.g. two buildings), all sharing one allowed distance
  let points = []; try { points = JSON.parse(setting("geo_points") || "[]"); } catch {}
  points = Array.isArray(points) ? points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : [];
  const lat = parseFloat(setting("geo_lat")), lng = parseFloat(setting("geo_lng"));
  if (!points.length && Number.isFinite(lat) && Number.isFinite(lng)) points = [{ name: "Clinic", lat, lng }];
  return { on: setting("geo_on") === "1" && points.length > 0, points, radius: Math.min(2000, Math.max(30, parseInt(setting("geo_radius")) || 150)) };
}
const metres = (la1, lo1, la2, lo2) => { const R = 6371000, r = (x) => (x * Math.PI) / 180, a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
const geoOut = (g) => ({ on: g.on, points: g.points, radius: g.radius });
router.get("/geo", requireAuth, requirePermission("staff:manage"), (req, res) => res.json(geoOut(geoCfg())));
router.put("/geo", requireAuth, requirePermission("staff:manage"), (req, res) => {
  const { lat, lng, name, remove, radius, on } = req.body || {};
  const set = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  let points = geoCfg().points;
  if (lat !== undefined || lng !== undefined) { // add a place (same name = move it)
    if (lat === null || lng === null || lat === "" || lng === "" || !(Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180)) return res.status(400).json({ error: "Clinic location is not valid" });
    const nm = String(name || "Clinic").trim().slice(0, 60) || "Clinic", pt = { name: nm, lat: Number(lat), lng: Number(lng) };
    const i = points.findIndex((p) => p.name.toLowerCase() === nm.toLowerCase());
    if (i >= 0) points[i] = pt; else if (points.length >= 6) return res.status(400).json({ error: "At most 6 places can be saved" }); else points.push(pt);
    set.run("geo_points", JSON.stringify(points));
  }
  if (remove !== undefined) { points = points.filter((_, i) => i !== Number(remove)); set.run("geo_points", JSON.stringify(points)); if (!points.length) set.run("geo_on", "0"); }
  if (radius !== undefined) { const r = Math.round(Number(radius)); if (!(r >= 30 && r <= 2000)) return res.status(400).json({ error: "Distance must be between 30 and 2000 metres" }); set.run("geo_radius", String(r)); }
  if (on !== undefined) { if (on && !points.length) return res.status(400).json({ error: "Set the clinic location first" }); set.run("geo_on", on ? "1" : "0"); }
  res.json(geoOut(geoCfg()));
});

router.get("/ping", requireKiosk, (req, res) => res.json({ ok: true, label: req.kiosk.label, enrolled: db.prepare("SELECT COUNT(*) n FROM face_templates").get().n, geo: geoCfg().on }));

router.post("/checkin", requireKiosk, (req, res) => {
  const { descriptor, snapshot, pos } = req.body || {};
  if (!okDesc(descriptor)) return res.status(400).json({ error: "No clear face seen" });
  const g = geoCfg();
  if (g.on) { // only at the clinic: no look, no mark, when the phone is away or does not share its location
    const la = Number(pos?.lat), lo = Number(pos?.lng), acc = Math.min(100, Math.max(0, Number(pos?.acc) || 0));
    if (!pos || !Number.isFinite(la) || !Number.isFinite(lo)) return res.json({ matched: false, needLocation: true });
    const away = Math.round(Math.min(...g.points.map((p) => metres(p.lat, p.lng, la, lo))));
    if (away - acc > g.radius) return res.json({ matched: false, outside: true, away });
  }
  const tpls = db.prepare("SELECT t.user_id, t.descriptors, u.name FROM face_templates t JOIN users u ON u.id = t.user_id WHERE u.active = 1").all().map((t) => ({ ...t, list: JSON.parse(t.descriptors) }));
  const rankFor = (desc) => tpls.map((t) => { let d = Infinity; for (const x of t.list) d = Math.min(d, dist(desc, x)); return { userId: t.user_id, name: t.name, distance: d }; }).sort((a, b) => a.distance - b.distance);
  // The phone sends two looks taken a moment apart: both must point to the same person, each clearly (one blurry look can never mark someone).
  const looks = Array.isArray(req.body?.descriptors) && req.body.descriptors.length === 2 && req.body.descriptors.every(okDesc) ? req.body.descriptors : [descriptor];
  const ranks = looks.map(rankFor);
  for (const ranked of ranks) {
    if (!ranked[0] || ranked[0].distance > MATCH_DISTANCE) return res.json({ matched: false });
    // Two different people both fit: refuse rather than mark the wrong person.
    if (ranked[1] && ranked[1].distance - ranked[0].distance < MATCH_MARGIN) return res.json({ matched: false, ambiguous: true });
  }
  if (ranks.length === 2 && ranks[0][0].userId !== ranks[1][0].userId) return res.json({ matched: false, ambiguous: true });
  const best = { ...ranks[0][0], distance: ranks.reduce((t, r) => t + r[0].distance, 0) / ranks.length };

  const now = process.env.NODE_ENV === "test" && req.headers["x-test-now"] ? new Date(String(req.headers["x-test-now"]) + "Z") : istNow(), date = now.toISOString().slice(0, 10), hhmm = now.toISOString().slice(11, 16);
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const row = db.prepare("SELECT status, in_time, out_time FROM attendance_marks WHERE user_id = ? AND mark_date = ?").get(best.userId, date);
  const prevJson = JSON.stringify({ date, had: !!row, status: row?.status ?? null, in_time: row?.in_time ?? null, out_time: row?.out_time ?? null }), ckId = randomUUID();
  let kind, mark = row?.status, inTime = row?.in_time || null, outTime = row?.out_time || null, already = false, noIn = false;
  const win = shiftWindow(best.userId, date);
  // First scan of the day happens near/after the end of the shift: the person is leaving, not arriving.
  const leavingOnly = (!row || !row.in_time) && !(row && row.out_time) && mins(hhmm) >= mins(win.end) - 120;
  if (row && !row.in_time && row.out_time) {
    kind = "out"; already = true;
  } else if (leavingOnly) {
    kind = "out"; outTime = hhmm; noIn = true;
    db.prepare(`INSERT INTO attendance_marks (user_id, mark_date, status, out_time, note, marked_by) VALUES (?,?,'P',?,?,NULL)
      ON CONFLICT(user_id, mark_date) DO UPDATE SET out_time = excluded.out_time, updated_at = datetime('now')`)
      .run(best.userId, date, outTime, `Check-out only ${hhmm} - no morning check-in, HR please verify`);
    mark = row?.status || "P";
  } else if (!row || !row.in_time) {
    kind = "in"; inTime = hhmm;
    if (!row || !["P", "L", "H"].includes(row.status)) mark = dayStatus(best.userId, date, hhmm, null);
    db.prepare(`INSERT INTO attendance_marks (user_id, mark_date, status, in_time, note, marked_by) VALUES (?,?,?,?,?,NULL)
      ON CONFLICT(user_id, mark_date) DO UPDATE SET status = excluded.status, in_time = excluded.in_time, updated_at = datetime('now')`)
      .run(best.userId, date, mark, inTime, `Face check-in ${hhmm}`);
  } else if (!outTime && mins(hhmm) - mins(inTime) >= MIN_GAP_MIN) { // check-out is taken once; a later look never moves it (HR can correct the time)
    // Well before the end of the shift a look is probably an accident (someone glancing at the phone): ask "Leaving now?" and record nothing until they confirm.
    if (mins(hhmm) < mins(win.end) - 60 && req.body?.confirmOut !== true) return res.json({ matched: true, confirmOut: true, name: best.name, kind: "out", inTime, time: hhmm, already: false });
    kind = "out"; outTime = hhmm;
    db.prepare("UPDATE attendance_marks SET out_time = ?, updated_at = datetime('now') WHERE user_id = ? AND mark_date = ?").run(outTime, best.userId, date);
    // Left before half of the shift was worked: the day becomes a Half day (never touches Leave / Absent).
    if (["P", "L"].includes(mark) && dayStatus(best.userId, date, inTime, outTime) === "H") {
      mark = "H"; db.prepare("UPDATE attendance_marks SET status = 'H' WHERE user_id = ? AND mark_date = ?").run(best.userId, date);
      try { syncLateFines(date.slice(0, 7)); } catch {}
    }
  } else { kind = outTime ? "out" : "in"; already = true; }
  if (!already) queueSheet(date.slice(0, 7));
  if (kind === "in" && !already) { try { syncLateFines(date.slice(0, 7)); } catch (e) { console.error("late fines:", e.message); } }
  const worked = inTime && outTime ? mins(outTime) - mins(inTime) : null;
  // A kind note to the person: leaving early, staying late, or leaving with no morning check-in.
  let note = null;
  if (kind === "out" && !already) {
    if (noIn) note = engage(best.userId, "no_morning_checkin", date);
    else if (worked !== null && worked >= 120 && mins(hhmm) < mins(win.end) - 15) note = engage(best.userId, "early_leave", date);
    else if (mins(hhmm) >= mins(win.end) + 60) note = engage(best.userId, "stayed_late", date);
  }
  if (!already) {
    let snapPath = null;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(snapshot || "");
    if (m && m[1].length < 400000) { snapPath = path.join(SNAP_DIR, `${randomUUID()}.jpg`); fs.writeFileSync(snapPath, Buffer.from(m[1], "base64")); }
    db.prepare("INSERT INTO face_checkins (id, user_id, device_id, distance, mark, kind, snapshot_path, prev, phone_id) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(ckId, best.userId, req.kiosk.id, best.distance, mark, kind, snapPath, prevJson, req.phoneId || null);
  }
  const lateMin = kind === "in" && mark === "L" && inTime ? Math.max(0, mins(inTime) - mins(win.start)) : 0;
  res.json({ matched: true, name: best.name, kind, mark, late: lateMin, label: MARKS[mark], time: kind === "out" ? outTime : inTime, inTime, outTime, workedMinutes: worked, already, noMorningCheckin: noIn, message: note ? note.body : null, undoId: already ? null : ckId });
});

// "Not me": the person on screen is not the person who looked. Cancels that one check-in (only the latest one, within 3 minutes) and puts the day back as it was.
router.post("/undo", requireKiosk, (req, res) => {
  const c = db.prepare("SELECT * FROM face_checkins WHERE id = ? AND device_id = ?").get(String(req.body?.id || ""), req.kiosk.id);
  if (!c) return res.status(404).json({ error: "Nothing to cancel" });
  if (c.undone_at) return res.json({ ok: true, already: true });
  if (Date.now() - new Date(String(c.created_at).replace(" ", "T") + "Z").getTime() > 3 * 60000) return res.status(400).json({ error: "Too late to cancel here. Ask HR to correct it." });
  if (db.prepare("SELECT 1 FROM face_checkins WHERE user_id = ? AND rowid > (SELECT rowid FROM face_checkins WHERE id = ?) AND undone_at IS NULL").get(c.user_id, c.id)) return res.status(400).json({ error: "Too late to cancel here. Ask HR to correct it." });
  const prev = c.prev ? JSON.parse(c.prev) : null, date = prev?.date || new Date(new Date(String(c.created_at).replace(" ", "T") + "Z").getTime() + 19800000).toISOString().slice(0, 10);
  if (!prev?.had) db.prepare("DELETE FROM attendance_marks WHERE user_id = ? AND mark_date = ?").run(c.user_id, date);
  else db.prepare("UPDATE attendance_marks SET status = ?, in_time = ?, out_time = ?, updated_at = datetime('now') WHERE user_id = ? AND mark_date = ?").run(prev.status, prev.in_time, prev.out_time, c.user_id, date);
  db.prepare("UPDATE face_checkins SET undone_at = datetime('now') WHERE id = ?").run(c.id);
  try { syncLateFines(date.slice(0, 7)); } catch {}
  queueSheet(date.slice(0, 7));
  res.json({ ok: true });
});

export default router;
