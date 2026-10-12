// Audit trail: who did what, when. Admins can review it at Activity Log.
import db from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

const insert = db.prepare("INSERT INTO audit_log (user_id, user_name, action, detail, ip, status) VALUES (?,?,?,?,?,?)");

export function audit({ userId = null, userName = null, action, detail = null, ip = null, status = null }) {
  try { insert.run(userId, userName, action, detail, ip, status); } catch (e) { console.error("audit failed", e.message); }
}

// Never log secrets: these paths carry PINs/passwords in the body, and we don't store bodies anyway.
// Logs every state-changing API call made by a signed-in user.
export function auditMiddleware(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/api/auth/login")) return;
    const u = req.user; // set by requireAuth inside the route
    if (!u) return;
    const name = db.prepare("SELECT name FROM users WHERE id = ?").get(u.userId)?.name || null;
    audit({ userId: u.userId, userName: name, action: `${req.method} ${req.originalUrl.split("?")[0]}`, ip: req.ip, status: res.statusCode });
  });
  next();
}
