import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Clinic Work Hub";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:5173";

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
