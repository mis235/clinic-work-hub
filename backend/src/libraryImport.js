// One-time: adds the clinic's "Patient Information" Drive material (videos, checklists, flowcharts, SOPs, presentations)
// to the Training Library as links. The catalog was read from the shared Drive folder; the files stay in Drive.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import db from "./db.js";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "library-patient-info.json");

export function importPatientInfoLibrary() {
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'lib_patient_info_v1'").get() || !fs.existsSync(FILE)) return { added: 0 };
  const items = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const has = db.prepare("SELECT 1 FROM training_videos WHERE url = ?");
  const next = db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM training_videos WHERE department = ?");
  const ins = db.prepare("INSERT INTO training_videos (id, department, folder, kind, file_name, title, url, description, file_path, mime, sort_order) VALUES (?,?,?,?,NULL,?,?,NULL,NULL,?,?)");
  let added = 0;
  db.transaction(() => {
    for (const it of items) {
      if (!it.url || has.get(it.url)) continue;
      ins.run(randomUUID(), it.department, it.folder || null, it.kind === "video" ? "video" : "file", it.title, it.url, it.mime || null, next.get(it.department).n);
      added++;
    }
  })();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('lib_patient_info_v1', '1')").run();
  return { added };
}
importPatientInfoLibrary();
