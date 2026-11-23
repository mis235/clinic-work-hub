// Keeps a Google Sheet in step with attendance. The sheet has a tiny Apps Script (copied from the app) that receives
// the month's rows and rewrites that month's tabs. Off until the link is saved in Attendance → Google Sheet.
import { randomBytes } from "node:crypto";
import db from "./db.js";
import { shiftWindow, isLateArrival } from "./routes/leave.js";

const get = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const set = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
const mins = (h) => { const [a, b] = String(h).split(":").map(Number); return a * 60 + b; };
const ist = () => new Date(Date.now() + 19800000).toISOString();
export const sheetUrl = () => get("att_sheet_webhook");
export const sheetKey = () => { let k = get("att_sheet_key"); if (!k) { k = randomBytes(9).toString("hex"); set("att_sheet_key", k); } return k; };
export const sheetState = () => ({ url: sheetUrl(), link: get("att_sheet_link"), status: get("att_sheet_status"), key: sheetKey() });
export const saveSheetSettings = ({ url, link }) => { set("att_sheet_webhook", url || ""); set("att_sheet_link", link || ""); };
const LABEL = { P: "Present", L: "Late", H: "Half day", LV: "Leave", A: "Absent", W: "Week off" };

/** The two tabs for one month: every person, every day so far, and the month summary. */
export function buildMonth(month) {
  const today = ist().slice(0, 10), [y, m] = month.split("-").map(Number);
  const last = month > today.slice(0, 7) ? 0 : month === today.slice(0, 7) ? Number(today.slice(8)) : new Date(y, m, 0).getDate();
  const staff = db.prepare("SELECT u.id, u.name, u.employee_code code, u.designation, d.name dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 AND COALESCE(u.no_attendance,0) = 0 ORDER BY d.name, u.name").all();
  const marks = new Map(db.prepare("SELECT * FROM attendance_marks WHERE substr(mark_date,1,7) = ?").all(month).map((r) => [r.user_id + "|" + r.mark_date, r]));
  const fines = new Map(db.prepare("SELECT user_id, SUM(amount) t FROM fines WHERE substr(fine_date,1,7) = ? GROUP BY user_id").all(month).map((f) => [f.user_id, f.t]));
  const daily = [], summary = [];
  for (const u of staff) {
    const c = { P: 0, L: 0, H: 0, LV: 0, A: 0, W: 0, none: 0 }; let lateMin = 0, worked = 0;
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`, r = marks.get(u.id + "|" + date), sh = shiftWindow(u.id, date);
      let late = 0;
      if (r?.in_time && isLateArrival(u.id, date, r.in_time)) late = Math.max(0, mins(r.in_time) - mins(sh.start));
      const hrs = r?.in_time && r?.out_time && mins(r.out_time) > mins(r.in_time) ? Math.round((mins(r.out_time) - mins(r.in_time)) / 6) / 10 : "";
      c[r?.status || "none"]++; lateMin += late; worked += hrs || 0;
      daily.push([date, u.code || "", u.name, u.dept || "", sh.start, sh.end, LABEL[r?.status] || "Not marked", r?.in_time || "", r?.out_time || "", late || "", hrs, r?.note || ""]);
    }
    summary.push([month, u.name, u.dept || "", c.P, c.L, c.H, c.LV, c.A, c.W, c.none, lateMin || "", Math.round(worked * 10) / 10, fines.get(u.id) || ""]);
  }
  return [
    { name: month, header: ["Date", "Employee code", "Name", "Department", "Shift start", "Shift end", "Status", "Check-in", "Check-out", "Late (min after shift start)", "Hours", "Note"], rows: daily },
    { name: month + " Summary", header: ["Month", "Name", "Department", "Present", "Late", "Half day", "Leave", "Absent", "Week off", "Not marked", "Late minutes", "Hours worked", "Fines (Rs)"], rows: summary },
  ];
}

export async function pushMonth(month) {
  const url = sheetUrl();
  if (!url) return { ok: false, error: "No Google Sheet link saved yet" };
  try {
    const tabs = buildMonth(month);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ key: sheetKey(), tabs }), redirect: "follow", signal: AbortSignal.timeout(60000) });
    const t = (await r.text()).slice(0, 200);
    if (!r.ok || !/^ok/i.test(t.trim())) throw new Error(/key/i.test(t) ? "The script says the key is wrong — copy the script from the app again" : `Google did not accept it (${r.status}). Check the script is deployed for “Anyone”.`);
    set("att_sheet_status", `Sent ${ist().slice(0, 16).replace("T", " ")} · ${month} · ${tabs[0].rows.length} rows`);
    return { ok: true, rows: tabs[0].rows.length };
  } catch (e) { set("att_sheet_status", `Failed ${ist().slice(0, 16).replace("T", " ")}: ${e.message}`); return { ok: false, error: e.message }; }
}
export async function pushAll() {
  const months = db.prepare("SELECT DISTINCT substr(mark_date,1,7) m FROM attendance_marks ORDER BY m").all().map((r) => r.m);
  const cur = ist().slice(0, 7); if (!months.includes(cur)) months.push(cur);
  let last = { ok: true, rows: 0 }; for (const m of months) { last = await pushMonth(m); if (!last.ok) return last; }
  return { ok: true, months: months.length };
}
const timers = new Map();
/** Called after any attendance change: sends that month a few seconds later (many changes at once = one send). */
export function queueSheet(month) {
  if (!sheetUrl() || timers.has(month)) return;
  timers.set(month, setTimeout(() => { timers.delete(month); pushMonth(month).catch(() => {}); }, 15000));
}
export const sheetScript = () => `// Clinic Work Hub — attendance receiver. Paste, Save, then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
var KEY = "${sheetKey()}";
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  if (d.key !== KEY) return ContentService.createTextOutput("wrong key");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  d.tabs.forEach(function (t) {
    var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
    sh.clear();
    var all = [t.header].concat(t.rows);
    sh.getRange(1, 1, all.length, t.header.length).setValues(all);
    sh.getRange(1, 1, 1, t.header.length).setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
    sh.setFrozenRows(1); sh.autoResizeColumns(1, t.header.length);
  });
  return ContentService.createTextOutput("ok");
}
function doGet() { return ContentService.createTextOutput("ok"); }
`;
