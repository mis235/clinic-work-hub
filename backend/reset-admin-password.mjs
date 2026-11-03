// Emergency: set a new admin password without logging in.  Usage: node reset-admin-password.mjs "NewPassword123"
import bcrypt from "bcryptjs";
import db from "./src/db.js";
import { adminEmail } from "./src/access.js";
const pw = process.argv[2];
if (!pw || pw.length < 8) { console.log("Give a new password of 8 or more characters."); process.exit(1); }
const r = db.prepare("UPDATE users SET password_hash = ? WHERE lower(email) = ?").run(bcrypt.hashSync(pw, 10), adminEmail());
console.log(r.changes ? `Done. ${adminEmail()} can now sign in with the new password.` : `No account found for ${adminEmail()}.`);
