import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import db from "../db.js";
import { shiftFor, SHIFT_TYPES } from "./roster.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Clinic Work Hub";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:4000";

function saveChallenge(userId, challenge, purpose) {
  db.prepare(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET challenge = excluded.challenge, purpose = excluded.purpose, created_at = datetime('now')`
  ).run(userId, challenge, purpose);
}

function consumeChallenge(userId, purpose) {
  const row = db.prepare("SELECT * FROM webauthn_challenges WHERE user_id = ? AND purpose = ?").get(userId, purpose);
  db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").run(userId);
  return row?.challenge || null;
}

// ---------------------------------------------------------------------------
// STEP 1 of registration: server hands the phone a challenge to sign with a
// newly-created biometric-locked key. This runs once per device per user.
// ---------------------------------------------------------------------------
router.get("/register/options", requireAuth, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
  const existing = db.prepare("SELECT id FROM webauthn_credentials WHERE user_id = ?").all(user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(user.id),
    userName: user.email || user.phone || user.name,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: {
      // "platform" forces the phone's own biometric (Face ID / fingerprint),
      // not a USB security key — this is the whole point of the feature.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  saveChallenge(user.id, options.challenge, "register");
  res.json(options);
});

// STEP 2 of registration: verify the phone's signed response and store the
// public key. From now on, this phone can authenticate this user biometrically.
router.post("/register/verify", requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const expectedChallenge = consumeChallenge(userId, "register");
  if (!expectedChallenge) return res.status(400).json({ error: "No registration in progress. Request options again." });

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Could not verify this device." });
    }
    const { credential } = verification.registrationInfo;
    db.prepare(
      `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, device_label, transports)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      credential.id,
      userId,
      Buffer.from(credential.publicKey).toString("base64url"),
      credential.counter,
      req.body.deviceLabel || "Registered device",
      JSON.stringify(req.body.response?.transports || [])
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// STEP 1 of check-in/out: server issues a challenge only this user's already-
// registered phone(s) can sign, using their fingerprint/Face ID.
// ---------------------------------------------------------------------------
router.get("/checkin/options", requireAuth, requirePermission("attendance:checkin"), async (req, res) => {
  const userId = req.user.userId;
  const creds = db.prepare("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?").all(userId);
  if (creds.length === 0) {
    return res.status(400).json({ error: "No registered device yet. Register this phone first." });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });

  saveChallenge(userId, options.challenge, "checkin");
  res.json(options);
});

// STEP 2: verify the biometric signature, then record the attendance event.
// Automatically alternates check_in / check_out based on the user's last record today.
router.post("/checkin/verify", requireAuth, requirePermission("attendance:checkin"), async (req, res) => {
  const userId = req.user.userId;
  const { credential, latitude, longitude } = req.body || {};
  const expectedChallenge = consumeChallenge(userId, "checkin");
  if (!expectedChallenge) return res.status(400).json({ error: "No check-in in progress. Request options again." });

  const stored = db.prepare("SELECT * FROM webauthn_credentials WHERE id = ? AND user_id = ?").get(credential?.id, userId);
  if (!stored) return res.status(400).json({ error: "Unrecognized device for this user." });

  try {
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.public_key, "base64url"),
        counter: stored.counter,
      },
    });
    if (!verification.verified) return res.status(400).json({ error: "Biometric verification failed." });

    db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(
      verification.authenticationInfo.newCounter,
      stored.id
    );

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const lastToday = db
      .prepare(
        `SELECT * FROM attendance WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC LIMIT 1`
      )
      .get(userId, todayStart.toISOString());

    const type = !lastToday || lastToday.type === "check_out" ? "check_in" : "check_out";
    const id = randomUUID();
    db.prepare(
      `INSERT INTO attendance (id, user_id, type, method, latitude, longitude) VALUES (?, ?, ?, 'biometric', ?, ?)`
    ).run(id, userId, type, latitude ?? null, longitude ?? null);

    res.json({ ok: true, type, recordedAt: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/attendance — own records, or everyone's with attendance:view_all
router.get("/", requireAuth, (req, res) => {
  const granted = db
    .prepare(`SELECT p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
    .all(req.user.roleId)
    .map((r) => r.action);

  let rows;
  if (granted.includes("attendance:view_all")) {
    rows = db
      .prepare(
        `SELECT a.*, u.name AS user_name, u.department_id, d.name AS department
         FROM attendance a JOIN users u ON u.id = a.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         ORDER BY a.recorded_at DESC LIMIT 200`
      )
      .all();
  } else if (granted.includes("attendance:view_own")) {
    rows = db.prepare("SELECT * FROM attendance WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 100").all(req.user.userId);
  } else {
    return res.status(403).json({ error: "Missing permission" });
  }
  res.json(rows);
});

// ---------------------------------------------------------------------------
// One-tap attendance. Works on every phone over plain http or https -- no
// fingerprint hardware or special browser support needed. The server decides
// whether the tap is a check-in or a check-out from what the person already
// did today (India time), so staff can never get it "the wrong way round".
// ---------------------------------------------------------------------------
const IST = "'+5 hours', '+30 minutes'";
const istDay = (col) => `date(${col}, ${IST})`;

function todayRecords(userId) {
  return db
    .prepare(`SELECT * FROM attendance WHERE user_id = ? AND ${istDay("recorded_at")} = ${istDay("'now'")} ORDER BY recorded_at ASC`)
    .all(userId);
}

router.get("/today", requireAuth, (req, res) => {
  const recs = todayRecords(req.user.userId);
  const last = recs[recs.length - 1];
  res.json({ records: recs, next: !last || last.type === "check_out" ? "check_in" : "check_out" });
});

router.post("/punch", requireAuth, (req, res) => {
  const { latitude, longitude, note } = req.body || {};
  const user = db.prepare("SELECT active FROM users WHERE id = ?").get(req.user.userId);
  if (!user?.active) return res.status(403).json({ error: "This account is not active" });
  const recs = todayRecords(req.user.userId);
  const last = recs[recs.length - 1];
  // Ignore accidental double-taps within 20 seconds.
  if (last && Date.now() - new Date(last.recorded_at.replace(" ", "T") + "Z").getTime() < 20000) {
    return res.json({ ok: true, duplicate: true, type: last.type, recorded_at: last.recorded_at });
  }
  const type = !last || last.type === "check_out" ? "check_in" : "check_out";
  const id = randomUUID();
  db.prepare("INSERT INTO attendance (id, user_id, type, method, latitude, longitude, note) VALUES (?, ?, ?, 'tap', ?, ?, ?)")
    .run(id, req.user.userId, type, Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null, note ? String(note).slice(0, 200) : null);
  const row = db.prepare("SELECT * FROM attendance WHERE id = ?").get(id);
  res.status(201).json({ ok: true, type, recorded_at: row.recorded_at });
});

// Anyone whose first check-in is after this India-time hour counts as "late" (set LATE_AFTER=HH:MM in .env to change).
const LATE_AFTER = /^\d{2}:\d{2}$/.test(process.env.LATE_AFTER || "") ? process.env.LATE_AFTER : "10:00";
export const isLateIn = (utc, start = LATE_AFTER) => !!utc && new Date(new Date(utc.replace(" ", "T") + "Z").getTime() + 19800000).toISOString().slice(11, 16) > start;
const startFor = (userId, date) => SHIFT_TYPES[shiftFor(userId, date)]?.start || LATE_AFTER; // the person's own shift start, else the clinic default

// Admin / manager board: everyone's first check-in, last check-out and hours for one day (default today).
router.get("/board", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const staff = db.prepare(
    `SELECT u.id, u.name, u.designation, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.active = 1 ORDER BY d.name, u.name`).all();
  const recs = db.prepare(`SELECT * FROM attendance WHERE ${istDay("recorded_at")} = ? ORDER BY recorded_at ASC`).all(date);
  const by = new Map();
  for (const r of recs) { if (!by.has(r.user_id)) by.set(r.user_id, []); by.get(r.user_id).push(r); }
  const toMs = (t) => new Date(t.replace(" ", "T") + "Z").getTime();
  const rows = staff.map((u) => {
    const list = by.get(u.id) || [];
    let ms = 0, openAt = null;
    for (const r of list) {
      if (r.type === "check_in" && openAt === null) openAt = toMs(r.recorded_at);
      else if (r.type === "check_out" && openAt !== null) { ms += toMs(r.recorded_at) - openAt; openAt = null; }
    }
    const first = list.find((r) => r.type === "check_in");
    const lastOut = [...list].reverse().find((r) => r.type === "check_out");
    return {
      ...u, late: isLateIn(first?.recorded_at, startFor(u.id, date)), shift: shiftFor(u.id, date), status: !list.length ? "absent" : openAt !== null ? "in" : "out",
      first_in: first?.recorded_at || null, last_out: lastOut?.recorded_at || null,
      hours: Math.round((ms / 3600000) * 10) / 10, methods: [...new Set(list.map((r) => r.method))],
    };
  });
  res.json({ date, late_after: LATE_AFTER, rows, present: rows.filter((r) => r.status !== "absent").length, total: rows.length });
});

// Monthly attendance for the whole team: days present per person.
router.get("/month", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date(Date.now() + 19800000).toISOString().slice(0, 7);
  const rows = db.prepare(
    `SELECT u.id, u.name, d.name AS department,
       COUNT(DISTINCT ${istDay("a.recorded_at")}) AS days_present
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN attendance a ON a.user_id = u.id AND a.type = 'check_in' AND substr(${istDay("a.recorded_at")}, 1, 7) = ?
     WHERE u.active = 1 GROUP BY u.id ORDER BY d.name, u.name`).all(month);
  res.json({ month, rows });
});

// The attendance register for a month, one row per person and one column per day:
// P = present, L = present but late, A = absent, W = Sunday off, "" = future day. Also late count and fines, like the paper sheet.
router.get("/register", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const nowIst = new Date(Date.now() + 19800000);
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : nowIst.toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayStr = nowIst.toISOString().slice(0, 10);
  const staff = db.prepare(
    `SELECT u.id, u.name, u.designation, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.active = 1 ORDER BY d.name, u.name`).all();
  const recs = db.prepare(`SELECT user_id, recorded_at, ${istDay("recorded_at")} AS day FROM attendance WHERE type = 'check_in' AND substr(${istDay("recorded_at")},1,7) = ? ORDER BY recorded_at`).all(month);
  const firstIn = new Map();
  for (const r of recs) { const k = r.user_id + "|" + r.day; if (!firstIn.has(k)) firstIn.set(k, r.recorded_at); }
  const fines = db.prepare("SELECT user_id, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM fines WHERE substr(fine_date,1,7) = ? GROUP BY user_id").all(month);
  const fineBy = new Map(fines.map((f) => [f.user_id, f]));
  const rows = staff.map((u) => {
    let present = 0, late = 0, absent = 0;
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      if (date > todayStr) { days.push(""); continue; }
      const t = firstIn.get(u.id + "|" + date);
      const planned = shiftFor(u.id, date);
      if (!t) { if (planned === "off" || (!planned && new Date(date + "T00:00:00Z").getUTCDay() === 0)) days.push("W"); else { days.push("A"); absent++; } }
      else if (isLateIn(t, startFor(u.id, date))) { days.push("L"); late++; present++; }
      else { days.push("P"); present++; }
    }
    const f = fineBy.get(u.id);
    return { ...u, days, present, late, absent, fine_count: f?.n || 0, fine_total: f?.total || 0 };
  });
  res.json({ month, daysInMonth, late_after: LATE_AFTER, rows });
});

// GET /api/attendance/registered — whether the current user has a registered device
router.get("/registered", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, device_label, created_at FROM webauthn_credentials WHERE user_id = ?")
    .all(req.user.userId);
  res.json(rows);
});

// Admin override — for the day someone's phone breaks and they need attendance logged manually.
// Always recorded with method 'manual' so it's clearly distinguishable in reports.
router.post("/manual", requireAuth, requirePermission("attendance:manual_override"), (req, res) => {
  const { userId, type } = req.body || {};
  if (!userId || !["check_in", "check_out"].includes(type)) {
    return res.status(400).json({ error: "userId and type ('check_in'|'check_out') are required" });
  }
  const id = randomUUID();
  db.prepare("INSERT INTO attendance (id, user_id, type, method) VALUES (?, ?, ?, 'manual')").run(id, userId, type);
  res.status(201).json({ id, userId, type, method: "manual" });
});

export default router;
