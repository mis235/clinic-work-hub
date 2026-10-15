// Only ONE account is the admin: the ADMIN_EMAIL account (admin@drnishitaranka.com). Everyone else is staff (or a manager the admin chooses).
import db from "./db.js";

export const adminEmail = () => String(process.env.ADMIN_EMAIL || "admin@drnishitaranka.com").trim().toLowerCase();
const isAdminAccount = (u) => String(u?.email || "").trim().toLowerCase() === adminEmail();

// Run at start-up (safe every time): that account is admin; anyone else who is admin goes back to staff.
export function ensureSingleAdmin() {
  const admin = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  const staff = db.prepare("SELECT id FROM roles WHERE name = 'staff'").get();
  if (!admin || !staff) return;
  for (const u of db.prepare("SELECT id, email, role_id FROM users").all()) {
    if (isAdminAccount(u) && u.role_id !== admin.id) db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(admin.id, u.id);
    else if (!isAdminAccount(u) && u.role_id === admin.id) db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(staff.id, u.id);
  }
}
// Error message if this role change is not allowed, otherwise null.
export function adminGrantError(roleName, targetUserId) {
  if (roleName !== "admin") return null;
  const t = db.prepare("SELECT email FROM users WHERE id = ?").get(targetUserId);
  return isAdminAccount(t) ? null : `Only one account is admin (${adminEmail()}). Everyone else is staff.`;
}

// ---- Who can see what (set by the admin in Staff → Edit) -----------------------------------------------------------
//  isHr        = can receive, confirm and approve leave, see late/birthday reports, change HR rules
//  leadership  = sees Insights, Knowledge and the full-clinic assistant (MIS, COS, COE, the doctors the admin chooses)
for (const sql of ["ALTER TABLE users ADD COLUMN is_hr INTEGER NOT NULL DEFAULT 0", "ALTER TABLE users ADD COLUMN leadership INTEGER NOT NULL DEFAULT 0"]) { try { db.exec(sql); } catch {} }
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)");
export function seedAccess() {
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'access_seeded'").get()) return;   // one-time starting values; the admin can change them afterwards
  db.exec(`UPDATE users SET is_hr = 1 WHERE designation LIKE '%HR%' OR designation LIKE '%Human Resource%'`);
  db.exec(`UPDATE users SET leadership = 1 WHERE designation LIKE '%MIS%' OR designation LIKE '%COS%' OR designation LIKE '%COE%' OR designation LIKE '%Director%' OR designation LIKE '%Founder%' OR designation LIKE '%Chief%'
           OR role_id IN (SELECT id FROM roles WHERE name = 'admin')`);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('access_seeded', '1')").run();
}
export function accessFor(userId, roleName) {
  const u = db.prepare("SELECT is_hr, leadership FROM users WHERE id = ?").get(userId) || {};
  const admin = roleName === "admin";
  return { isHr: admin || u.is_hr === 1, leadership: admin || u.leadership === 1 };
}
export const isLeadership = (userId, roleName) => accessFor(userId, roleName).leadership;
// Express guard: Insights / Knowledge / advisor tools are for leadership only.
export function requireLeadership(req, res, next) {
  if (accessFor(req.user.userId, req.user.roleName).leadership) return next();
  res.status(403).json({ error: "This section is for the clinic leadership team" });
}
