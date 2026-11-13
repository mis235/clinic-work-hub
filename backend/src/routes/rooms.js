// Procedure Rooms: 1 room on the 1st floor, 4 on the 3rd floor. The 3rd-floor coordinator records who is in which room;
// each entry is also posted to a WhatsApp group through an n8n webhook when one is set (setting "rooms_webhook").
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";

export const ROOMS = [
  { key: "f1-r1", floor: "1st Floor", name: "Room 1" },
  { key: "f3-r1", floor: "3rd Floor", name: "Room 1" },
  { key: "f3-r2", floor: "3rd Floor", name: "Room 2" },
  { key: "f3-r3", floor: "3rd Floor", name: "Room 3" },
  { key: "f3-r4", floor: "3rd Floor", name: "Room 4" },
];
db.exec(`CREATE TABLE IF NOT EXISTS room_sessions (
  id TEXT PRIMARY KEY, room_key TEXT NOT NULL, work_date TEXT NOT NULL, patient TEXT NOT NULL, procedure_name TEXT NOT NULL,
  therapist TEXT, doctor TEXT, check_in TEXT NOT NULL, check_out TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_room_sessions_date ON room_sessions(work_date, room_key)");

const router = Router();
const ist = () => new Date(Date.now() + 19800000);
const today = () => ist().toISOString().slice(0, 10);
const nowHHMM = () => ist().toISOString().slice(11, 16);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const roomLabel = (k) => { const r = ROOMS.find((x) => x.key === k); return r ? `${r.floor} — ${r.name}` : k; };
// Who may record: admin, managers, leadership, HR, and the 3rd-floor / procedure coordinators.
function canRecord(req) {
  const u = db.prepare("SELECT shift_role FROM users WHERE id = ?").get(req.user.userId);
  const a = accessFor(req.user.userId, req.user.roleName);
  return req.user.roleName === "admin" || req.user.roleName === "manager" || a.isHr || a.leadership || /3rd floor|procedure/i.test(u?.shift_role || "");
}
const ser = (r) => ({ id: r.id, room: r.room_key, roomLabel: roomLabel(r.room_key), date: r.work_date, patient: r.patient, procedure: r.procedure_name, therapist: r.therapist || "", doctor: r.doctor || "", checkIn: r.check_in, checkOut: r.check_out || null });

export function messageFor(s, event) {
  const head = event === "out" ? "PROCEDURE COMPLETED" : "PROCEDURE STARTED";
  return [head, `Room: ${s.roomLabel}`, `Patient: ${s.patient}`, `Procedure: ${s.procedure}`, s.therapist && `Therapist: ${s.therapist}`, s.doctor && `Doctor: ${s.doctor}`,
    `Check-in: ${s.checkIn}`, event === "out" && `Check-out: ${s.checkOut}`].filter(Boolean).join("\n");
}
function notify(s, event) {   // fire-and-forget to n8n; never blocks or breaks the save
  try {
    const url = db.prepare("SELECT value FROM app_settings WHERE key = 'rooms_webhook'").get()?.value;
    if (!url) return;
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ event, text: messageFor(s, event), ...s }) }).catch((e) => console.error("rooms webhook:", e.message));
  } catch {}
}

router.get("/", requireAuth, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : today();
  const rows = db.prepare("SELECT * FROM room_sessions WHERE work_date = ? ORDER BY check_in, created_at").all(date).map(ser);
  const names = db.prepare("SELECT name FROM users WHERE active = 1 ORDER BY name").all().map((u) => u.name);
  res.json({
    date, nowDate: today(), canRecord: canRecord(req), staffNames: names, nowTime: nowHHMM(),
    rooms: ROOMS.map((r) => ({ ...r, current: date === today() ? rows.find((s) => s.room === r.key && !s.checkOut) || null : null, count: rows.filter((s) => s.room === r.key).length })),
    sessions: rows,
  });
});

router.post("/:room/start", requireAuth, (req, res) => {
  if (!canRecord(req)) return res.status(403).json({ error: "Only the 3rd floor coordinator, HR, managers or admin can record rooms" });
  const room = ROOMS.find((r) => r.key === req.params.room); if (!room) return res.status(404).json({ error: "Unknown room" });
  const b = req.body || {}, patient = String(b.patient || "").trim(), procedure = String(b.procedure || "").trim();
  if (!patient || !procedure) return res.status(400).json({ error: "Patient name and procedure name are needed" });
  const checkIn = HHMM.test(b.checkIn || "") ? b.checkIn : nowHHMM();
  if (db.prepare("SELECT 1 FROM room_sessions WHERE room_key = ? AND check_out IS NULL AND work_date = ?").get(room.key, today()))
    return res.status(409).json({ error: `${room.floor} ${room.name} already has a patient. Check them out first.` });
  const id = randomUUID();
  db.prepare("INSERT INTO room_sessions (id, room_key, work_date, patient, procedure_name, therapist, doctor, check_in, created_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, room.key, today(), patient.slice(0, 80), procedure.slice(0, 120), String(b.therapist || "").trim().slice(0, 60) || null, String(b.doctor || "").trim().slice(0, 60) || null, checkIn, req.user.userId);
  const s = ser(db.prepare("SELECT * FROM room_sessions WHERE id = ?").get(id));
  notify(s, "in");
  res.status(201).json({ ...s, text: messageFor(s, "in") });
});

router.post("/sessions/:id/finish", requireAuth, (req, res) => {
  if (!canRecord(req)) return res.status(403).json({ error: "Not allowed" });
  const row = db.prepare("SELECT * FROM room_sessions WHERE id = ?").get(req.params.id); if (!row) return res.status(404).json({ error: "Not found" });
  const out = HHMM.test(req.body?.checkOut || "") ? req.body.checkOut : nowHHMM();
  db.prepare("UPDATE room_sessions SET check_out = ? WHERE id = ?").run(out, row.id);
  const s = ser(db.prepare("SELECT * FROM room_sessions WHERE id = ?").get(row.id));
  notify(s, "out");
  res.json({ ...s, text: messageFor(s, "out") });
});

router.delete("/sessions/:id", requireAuth, (req, res) => {
  if (!(req.user.roleName === "admin" || accessFor(req.user.userId, req.user.roleName).isHr)) return res.status(403).json({ error: "Admin or HR only" });
  db.prepare("DELETE FROM room_sessions WHERE id = ?").run(req.params.id); res.json({ ok: true });
});
export default router;
