// Who may hold the "admin" role. Only the four owners/leaders below; nobody else can be made admin from the app.
import db from "./db.js";

const OWNER_PREFIXES = ["dr. nishita", "dr nishita", "shreyas", "naga", "neelima"];
export const isOwnerName = (name = "") => { const n = String(name).trim().toLowerCase(); return OWNER_PREFIXES.some((p) => n === p || n.startsWith(p + " ") || n.startsWith(p + "(")); };

// Run at start-up: make sure those four are admins (safe to run every time).
export function ensureOwnerAdmins() {
  const admin = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  if (!admin) return;
  for (const u of db.prepare("SELECT id, name, role_id FROM users WHERE active = 1").all()) {
    if (isOwnerName(u.name) && u.role_id !== admin.id) db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(admin.id, u.id);
  }
}
// Returns an error message if this role change is not allowed, otherwise null.
export function adminGrantError(roleName, targetUserId) {
  if (roleName !== "admin") return null;
  const t = db.prepare("SELECT name FROM users WHERE id = ?").get(targetUserId);
  return t && isOwnerName(t.name) ? null : "Admin access is only for Dr. Nishita, Shreyas, Naga and Neelima.";
}
