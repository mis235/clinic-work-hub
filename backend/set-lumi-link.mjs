// Save the n8n chat link for Lumi without logging in.  Usage: node set-lumi-link.mjs "https://…/webhook/…/chat"
import db from "./src/db.js";
import { cleanChatUrl } from "./src/routes/clinicAi.js";
const url = cleanChatUrl(process.argv[2]);
if (!url) { console.log("That does not look like the n8n chat link (…/webhook/…/chat)."); process.exit(1); }
db.prepare("INSERT INTO app_settings (key, value) VALUES ('clinic_ai_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(url);
console.log("Done. Lumi is connected to: " + url);
