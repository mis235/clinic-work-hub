import jwt from "jsonwebtoken";
import db from "../db.js";

// Read lazily so the value is always the one from backend/.env, however files are loaded.
const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing in backend/.env");
  return process.env.JWT_SECRET;
};

export function signToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: "7d" });
}

// Verifies the token and attaches { userId, roleId, roleName, departmentId } to req.user.
// This is the ONLY thing that ever runs for every request, on every device and channel —
// there is no separate "admin app" or "staff app" backend, just one API gated by role.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, secret());
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  // Removed / deactivated people lose access immediately, not when their token expires.
  const row = db.prepare("SELECT active FROM users WHERE id = ?").get(req.user.userId);
  if (!row || !row.active) return res.status(401).json({ error: "This account is no longer active" });
  next();
}

const permCache = new Map(); // roleId -> Set(action)  (cleared automatically on server restart; fine for this scale)

function permissionsForRole(roleId) {
  if (permCache.has(roleId)) return permCache.get(roleId);
  const rows = db
    .prepare(
      `SELECT p.action FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
    )
    .all(roleId);
  const set = new Set(rows.map((r) => r.action));
  permCache.set(roleId, set);
  return set;
}

// USER -> ROLE -> DEPARTMENT -> PERMISSION -> ACTION
// Usage: requirePermission('task:assign')
export function requirePermission(action) {
  return (req, res, next) => {
    const granted = permissionsForRole(req.user?.roleId);
    if (!granted.has(action)) {
      return res.status(403).json({ error: `Missing permission: ${action}` });
    }
    next();
  };
}

export function clearPermissionCache() {
  permCache.clear();
}
