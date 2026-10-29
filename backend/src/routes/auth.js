import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { loginThrottle } from "../security.js";
import { audit } from "../audit.js";
import { accessFor } from "../access.js";

const router = Router();

function userWithRole(row) {
  const role = db.prepare("SELECT name FROM roles WHERE id = ?").get(row.role_id);
  const dept = row.department_id
    ? db.prepare("SELECT name FROM departments WHERE id = ?").get(row.department_id)
    : null;
  return {
    id: row.id,
    name: row.name,
    role: role?.name,
    department: dept?.name || null,
    phone: row.phone,
    mustChangePin: !!row.must_change_pin,
    ...accessFor(row.id, role?.name),
    designation: row.designation || null,
  };
}

// POST /api/auth/change-password — the signed-in admin/manager changes their own password (no file editing needed).
router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.userId);
  if (!row?.password_hash) return res.status(400).json({ error: "This account signs in with a PIN. Change the PIN instead." });
  if (!bcrypt.compareSync(String(currentPassword || ""), row.password_hash)) return res.status(401).json({ error: "The current password is not right." });
  const np = String(newPassword || "");
  if (np.length < 8) return res.status(400).json({ error: "Use at least 8 characters." });
  if (/^(change-this-password|password|12345678)$/i.test(np)) return res.status(400).json({ error: "Choose a password that is not easy to guess." });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(np, 10), row.id);
  audit({ userId: row.id, action: "PASSWORD_CHANGED", detail: "" });
  res.json({ ok: true });
});

// POST /api/auth/login
// Accepts EITHER { email, password } (typical for admin/manager on desktop)
// OR { userId, pin } (typical for staff on a shared device / mobile).
// Same endpoint, same token shape, same permission model regardless of which — this
// is what "device type must never determine authorization" means in practice.
router.post("/login", loginThrottle, (req, res) => {
  const { email, password, userId, pin, deviceLabel, channel } = req.body || {};

  let row;
  if (email) {
    row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
    if (!row || !row.password_hash || !bcrypt.compareSync(String(password || ""), row.password_hash)) {
      audit({ userName: String(email), action: "LOGIN_FAILED", ip: req.ip, status: 401 });
      return res.status(401).json({ error: "Invalid credentials" });
    }
  } else if (userId) {
    row = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(userId);
    if (!row || !row.pin_hash || !bcrypt.compareSync(String(pin || ""), row.pin_hash)) {
      audit({ userId: String(userId), action: "LOGIN_FAILED", ip: req.ip, status: 401 });
      return res.status(401).json({ error: "Incorrect PIN" });
    }
  } else {
    return res.status(400).json({ error: "Provide either email+password or userId+pin" });
  }

  const user = userWithRole(row);

  db.prepare(
    "INSERT INTO sessions (id, user_id, device_label, channel) VALUES (?, ?, ?, ?)"
  ).run(randomUUID(), row.id, deviceLabel || "Unknown device", channel || "web");

  audit({ userId: row.id, userName: row.name, action: "LOGIN", ip: req.ip, status: 200 });
  const token = signToken({
    userId: row.id,
    roleId: row.role_id,
    roleName: user.role,
    departmentId: row.department_id,
  });

  res.json({ token, user });
});

export default router;
