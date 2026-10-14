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
