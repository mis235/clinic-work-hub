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
import { syncLateFines } from "./leave.js";

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

// ---------------------------------------------------------------------------
// Attendance register. Staff do NOT check in on the app: the admin / manager marks each day
// (like the paper sheet), and everything else (dashboard, fines, payroll hints) reads from these marks.
// ---------------------------------------------------------------------------
db.exec(`CREATE TABLE IF NOT EXISTS attendance_marks (
  user_id TEXT NOT NULL REFERENCES users(id),
  mark_date TEXT NOT NULL,           -- YYYY-MM-DD (India date)
  status TEXT NOT NULL,              -- P present | L late | H half day | LV leave | A absent | W week off / holiday
  note TEXT,
  marked_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, mark_date)
);`);
for (const col of ["in_time", "out_time"]) { try { db.exec(`ALTER TABLE attendance_marks ADD COLUMN ${col} TEXT`); } catch {} } // "HH:MM" India time, set by the face check-in
export const MARKS = { P: "Present", L: "Late", H: "Half day", LV: "Leave", A: "Absent", W: "Week off / holiday" };
const isLead = (u) => u?.roleName === "admin" || u?.roleName === "manager";
const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** { P: n, L: n, ... } plus present-day total for one person in one month (used by the staff home screen). */
export function monthCounts(userId, month) {
  const rows = db.prepare("SELECT status, COUNT(*) n FROM attendance_marks WHERE user_id = ? AND substr(mark_date,1,7) = ? GROUP BY status").all(userId, month);
  const c = { P: 0, L: 0, H: 0, LV: 0, A: 0, W: 0 };
  for (const r of rows) c[r.status] = r.n;
  return { ...c, present: c.P + c.L + c.H * 0.5 };
}
export const markFor = (userId, date) => db.prepare("SELECT status FROM attendance_marks WHERE user_id = ? AND mark_date = ?").get(userId, date)?.status || null;

router.get("/board", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const date = DATE_RE.test(req.query.date || "") ? req.query.date : istToday();
  const rows = db.prepare(
    `SELECT u.id, u.name, u.designation, d.name AS department, m.status AS mark, m.note, m.in_time, m.out_time
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN attendance_marks m ON m.user_id = u.id AND m.mark_date = ?
     WHERE u.active = 1 ORDER BY d.name, u.name`).all(date);
  const counts = { P: 0, L: 0, H: 0, LV: 0, A: 0, W: 0, unmarked: 0 };
  for (const r of rows) counts[r.mark || "unmarked"]++;
  res.json({ date, rows, counts, total: rows.length, present: counts.P + counts.L + counts.H, labels: MARKS });
});

// Mark one person for one day. status "" clears the mark.
router.put("/mark", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Only admin or a manager can mark attendance" });
  const { userId, date, status, note } = req.body || {};
  if (!DATE_RE.test(date || "") || date > istToday()) return res.status(400).json({ error: "Choose today or an earlier date" });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(userId)) return res.status(400).json({ error: "Choose a staff member" });
  if (!status) db.prepare("DELETE FROM attendance_marks WHERE user_id = ? AND mark_date = ?").run(userId, date);
  else if (!MARKS[status]) return res.status(400).json({ error: "Unknown status" });
  else db.prepare(
    `INSERT INTO attendance_marks (user_id, mark_date, status, note, marked_by) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, mark_date) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, updated_at = datetime('now')`
  ).run(userId, date, status, note ? String(note).slice(0, 200) : null, req.user.userId);
  try { syncLateFines(date.slice(0, 7)); } catch {}
  res.json({ ok: true });
});

// Mark everyone who is still unmarked for a day in one go (e.g. all Present, then fix the exceptions).
router.post("/mark-day", requireAuth, (req, res) => {
  if (!isLead(req.user)) return res.status(403).json({ error: "Only admin or a manager can mark attendance" });
  const { date, status, department } = req.body || {};
  if (!DATE_RE.test(date || "") || date > istToday()) return res.status(400).json({ error: "Choose today or an earlier date" });
  if (!MARKS[status]) return res.status(400).json({ error: "Unknown status" });
  const users = db.prepare(
    `SELECT u.id FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 ${department ? "AND d.name = ?" : ""}
     AND NOT EXISTS (SELECT 1 FROM attendance_marks m WHERE m.user_id = u.id AND m.mark_date = ?)`).all(...(department ? [department, date] : [date]));
  const ins = db.prepare("INSERT INTO attendance_marks (user_id, mark_date, status, marked_by) VALUES (?,?,?,?)");
  db.transaction(() => users.forEach((u) => ins.run(u.id, date, status, req.user.userId)))();
  res.json({ ok: true, marked: users.length });
});

// The month register: one row per person, one column per day, with totals and fines.
router.get("/register", requireAuth, requirePermission("attendance:view_all"), (req, res) => {
  const now = istToday();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : now.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const staff = db.prepare(
    `SELECT u.id, u.name, u.designation, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.active = 1 ORDER BY d.name, u.name`).all();
  const marks = db.prepare("SELECT user_id, mark_date, status FROM attendance_marks WHERE substr(mark_date,1,7) = ?").all(month);
  const by = new Map(marks.map((r) => [r.user_id + "|" + r.mark_date, r.status]));
  const fines = db.prepare("SELECT user_id, COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM fines WHERE substr(fine_date,1,7) = ? GROUP BY user_id").all(month);
  const fineBy = new Map(fines.map((f) => [f.user_id, f]));
  const rows = staff.map((u) => {
    const c = { P: 0, L: 0, H: 0, LV: 0, A: 0, W: 0 };
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const st = by.get(u.id + "|" + date) || "";
      if (st) c[st]++;
      days.push(st);
    }
    const f = fineBy.get(u.id);
    return { ...u, days, present: c.P + c.L + c.H * 0.5, late: c.L, absent: c.A, leave: c.LV, fine_count: f?.n || 0, fine_total: f?.total || 0 };
  });
  res.json({ month, daysInMonth, today: now, labels: MARKS, rows });
});

// Download the month as an Excel sheet: every person, every day: status, login time, logout time, hours.
const hoursBetween = (a, b) => { if (!a || !b) return null; const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); const x = (h2 * 60 + m2) - (h1 * 60 + m1); return x > 0 ? Math.round(x / 6) / 10 : null; };
router.get("/export", requireAuth, requirePermission("attendance:view_all"), async (req, res) => {
  const now = istToday();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : now.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = Math.min(new Date(y, m, 0).getDate(), month === now.slice(0, 7) ? Number(now.slice(8)) : 31);
  const staff = db.prepare(`SELECT u.id, u.name, u.employee_code, u.designation, d.name AS department FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 ORDER BY d.name, u.name`).all();
  const marks = new Map(db.prepare("SELECT * FROM attendance_marks WHERE substr(mark_date,1,7) = ?").all(month).map((r) => [r.user_id + "|" + r.mark_date, r]));
  const fines = new Map(db.prepare("SELECT user_id, COALESCE(SUM(amount),0) t FROM fines WHERE substr(fine_date,1,7) = ? GROUP BY user_id").all(month).map((f) => [f.user_id, f.t]));
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Daily log");
  ws.columns = [["Date", 12], ["Employee code", 14], ["Name", 24], ["Department", 18], ["Designation", 24], ["Status", 16], ["Login time", 11], ["Logout time", 11], ["Hours", 8], ["Note", 28]].map(([header, width]) => ({ header, width }));
  const sm = wb.addWorksheet("Month summary");
  sm.columns = [["Name", 24], ["Department", 18], ["Present", 9], ["Late", 7], ["Half day", 9], ["Leave", 8], ["Absent", 8], ["Week off", 9], ["Not marked", 11], ["Total hours", 11], ["Fines (Rs)", 11]].map(([header, width]) => ({ header, width }));
  for (const u of staff) {
    const c = { P: 0, L: 0, H: 0, LV: 0, A: 0, W: 0, none: 0 }; let hrs = 0;
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const r = marks.get(u.id + "|" + date);
      const h = hoursBetween(r?.in_time, r?.out_time);
      if (h) hrs += h;
      c[r?.status || "none"]++;
      ws.addRow([date, u.employee_code || "", u.name, u.department || "", u.designation || "", r ? MARKS[r.status] : "Not marked", r?.in_time || "", r?.out_time || "", h ?? "", r?.note || ""]);
    }
    sm.addRow([u.name, u.department || "", c.P, c.L, c.H, c.LV, c.A, c.W, c.none, Math.round(hrs * 10) / 10, fines.get(u.id) || 0]);
  }
  for (const sh of [ws, sm]) { sh.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D4AFF" } }; sh.views = [{ state: "frozen", ySplit: 1 }]; }
  ws.autoFilter = { from: "A1", to: "J1" };
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${month}.xlsx"`);
  await wb.xlsx.write(res); res.end();
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
