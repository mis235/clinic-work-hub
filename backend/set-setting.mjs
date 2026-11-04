// Server-side settings (no login). Usage:
//   node set-setting.mjs sheet  "<Google Sheet link>"          -> the app reads the old checklist sheet every 10 minutes
//   node set-setting.mjs push   "<Apps Script /exec link>" "<secret word>"  -> each submitted checklist is also added to the sheet
import db from "./src/db.js";
import { normalizeSheetUrl } from "./src/routes/shiftChecklist.js";
const put = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
const [what, a, b] = process.argv.slice(2);
if (what === "sheet" && /^https?:\/\//.test(a || "")) { put("checklist_sheet_csv", a); console.log("Done. Sheet link saved:", normalizeSheetUrl(a)); }
else if (what === "push" && /^https:\/\/script\.google\.com\/\S+\/exec$/.test(a || "") && b) { put("checklist_push_url", a); put("checklist_push_key", b); console.log("Done. Checklists will also be added to the Google Sheet."); }
else { console.log('Usage: set-setting.mjs sheet "<link>"  |  set-setting.mjs push "<…/exec link>" "<secret word>"'); process.exit(1); }
