// Live clinic numbers from the clinic's own Google Sheets (procedures, suggested vs done, sales, leads).
// A small Apps Script on the owner's Google account reads the sheets and hands them to this server every 10 minutes.
// Only totals are kept here (no patient names or phone numbers are stored or sent to the browser).
import { Router } from "express";
import { randomBytes } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireLeadership } from "../access.js";

const router = Router();
const get = (k) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(k)?.value || "";
const set = (k, v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, String(v));
const ist = () => new Date(Date.now() + 19800000).toISOString();
const key = () => { let k = get("live_feed_key"); if (!k) { k = randomBytes(9).toString("hex"); set("live_feed_key", k); } return k; };

const SOURCES = {
  procedures: { id: "17nKGM_2bv-3O0y10XXKlYsrk-H1Q4nNU0UQSUhdLwQM", tab: "Daily Procedures 2026", cols: ["Date", "Patient ID", "Procedures", "Category"] },
  suggested: { id: "1by72If2xcVd8CmRgDYKxtHoJIIF1z1EK3MyZt03IaYs", tab: "Suggested procedures 2026", cols: ["Date", "Patient ID", "Procedures", "Whether Done Or Not", "Category"] },
  invoices: { id: "1cs5UpDzvsnpl_7BAvMKBuca2P-4r7kMS7PnBYSSkYYY", tab: "All Invoices", cols: ["Date", "Procedure", "Invoice Total", "Paid", "Pending", "Status", "Category"] },
  leads: { id: "1M38KgtxHBfZafyD8Wv6GDyThkJgEFRUWXUnbNybnT9U", tab: "Leads", cols: ["Received At", "Status", "Stage", "Source", "Assignee"] },
};
export const feedScript = () => `// Clinic Work Hub — live numbers feed. Paste, Save, then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
var KEY = "${key()}";
var SRC = ${JSON.stringify(SOURCES, null, 1)};
function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== KEY) return ContentService.createTextOutput("wrong key");
  var out = {};
  Object.keys(SRC).forEach(function (k) {
    try {
      var s = SRC[k], sh = SpreadsheetApp.openById(s.id).getSheetByName(s.tab);
      var v = sh.getDataRange().getDisplayValues(), head = v[0].map(function (h) { return String(h).trim(); });
      var idx = s.cols.map(function (c) { return head.indexOf(c); });
      out[k] = v.slice(1).filter(function (r) { return r.join("") !== ""; }).map(function (r) { return idx.map(function (i) { return i < 0 ? "" : r[i]; }); });
    } catch (err) { out[k] = { error: String(err) }; }
  });
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
`;

// ---- turning rows into totals ----
const iso = (s) => { s = String(s || "").trim(); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0] : ""; };
const num = (x) => { const n = Number(String(x || "").replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const tally = (arr, f) => { const m = new Map(); for (const r of arr) { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n); };
const top = (a, n = 10) => a.slice(0, n);
const lastDays = (dates, n = 14) => { const today = ist().slice(0, 10), out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.parse(today) - i * 86400000).toISOString().slice(0, 10); out.push({ d, n: dates.filter((x) => x === d).length }); } return out; };
const monthsOf = (rows, f) => [...new Set(rows.map(f).filter(Boolean))].sort();

export function compute(raw) {
  const out = { updatedAt: ist().slice(0, 16).replace("T", " "), errors: {} };
  for (const k of Object.keys(SOURCES)) if (!Array.isArray(raw[k])) out.errors[k] = raw[k]?.error || "No data";
  if (Array.isArray(raw.procedures)) {
    const rows = raw.procedures.map((r) => ({ d: iso(r[0]), p: r[1], proc: String(r[2] || "").trim(), cat: String(r[3] || "").trim() })).filter((r) => r.d);
    const ms = monthsOf(rows, (r) => r.d.slice(0, 7)), cur = ms[ms.length - 1], now = rows.filter((r) => r.d.slice(0, 7) === cur);
    out.procedures = { focus: cur, total: rows.length, thisMonth: now.length, patients: new Set(now.map((r) => r.p)).size,
      byMonth: ms.slice(-12).map((m) => { const x = rows.filter((r) => r.d.slice(0, 7) === m); return { m, n: x.length, patients: new Set(x.map((r) => r.p)).size }; }),
      byCategory: top(tally(now, (r) => r.cat)), topProcedures: top(tally(now, (r) => r.proc)), last14: lastDays(rows.map((r) => r.d)) };
  }
  if (Array.isArray(raw.suggested)) {
    const rows = raw.suggested.map((r) => ({ d: iso(r[0]), done: /^y/i.test(String(r[3]).trim()), cat: String(r[4] || "").trim() || "Other" })).filter((r) => r.d);
    const ms = monthsOf(rows, (r) => r.d.slice(0, 7)), cats = [...new Set(rows.map((r) => r.cat))];
    const sd = (x) => ({ sug: x.length, done: x.filter((r) => r.done).length });
    out.suggested = { total: rows.length, ...(() => { const t = sd(rows); return { done: t.done, pending: t.sug - t.done, rate: t.sug ? Math.round((t.done / t.sug) * 100) : 0 }; })(),
      byMonth: ms.slice(-12).map((m) => ({ m, ...sd(rows.filter((r) => r.d.slice(0, 7) === m)) })),
      byCategory: cats.map((k) => ({ k, ...sd(rows.filter((r) => r.cat === k)) })).sort((a, b) => b.sug - a.sug).slice(0, 10) };
  }
  if (Array.isArray(raw.invoices)) {
    const rows = raw.invoices.map((r) => ({ d: iso(r[0]), proc: r[1], total: num(r[2]), paid: num(r[3]), pend: num(r[4]), st: String(r[5] || "").toLowerCase(), cat: String(r[6] || "").trim() || "Other" })).filter((r) => r.d && !/cancel|void/.test(r.st));
    const ms = monthsOf(rows, (r) => r.d.slice(0, 7)), cur = ms[ms.length - 1], sum = (x, f) => Math.round(x.reduce((a, r) => a + f(r), 0));
    const now = rows.filter((r) => r.d.slice(0, 7) === cur), cats = [...new Set(now.map((r) => r.cat))];
    out.revenue = { focus: cur, invoices: now.length, thisMonth: sum(now, (r) => r.total), paid: sum(now, (r) => r.paid), pending: sum(now, (r) => r.pend), pendingAll: sum(rows, (r) => r.pend),
      byMonth: ms.slice(-12).map((m) => { const x = rows.filter((r) => r.d.slice(0, 7) === m); return { m, total: sum(x, (r) => r.total), paid: sum(x, (r) => r.paid), pending: sum(x, (r) => r.pend) }; }),
      byCategory: cats.map((k) => ({ k, n: sum(now.filter((r) => r.cat === k), (r) => r.total) })).sort((a, b) => b.n - a.n).slice(0, 10) };
  }
  if (Array.isArray(raw.leads)) {
    const rows = raw.leads.map((r) => ({ d: iso(r[0]), st: String(r[1] || "").trim(), stage: String(r[2] || "").trim(), src: String(r[3] || "").trim(), who: String(r[4] || "").trim() }));
    out.leads = { total: rows.length, byStatus: top(tally(rows, (r) => r.st)), byStage: top(tally(rows, (r) => r.stage)), bySource: top(tally(rows, (r) => r.src)), byAssignee: top(tally(rows, (r) => r.who)), last14: lastDays(rows.map((r) => r.d)) };
  }
  return out;
}

export async function refreshLive() {
  const url = get("live_feed_url");
  if (!url) return { ok: false, error: "No Google link saved yet" };
  try {
    const r = await fetch(`${url}?key=${encodeURIComponent(key())}`, { redirect: "follow", signal: AbortSignal.timeout(90000) });
    const t = await r.text();
    let raw; try { raw = JSON.parse(t); } catch { throw new Error(/wrong key/i.test(t) ? "The script says the key is wrong — copy the script from the app again" : "Google did not send the numbers. Check the script is deployed for “Anyone”."); }
    set("live_numbers", JSON.stringify(compute(raw))); set("live_numbers_status", `Updated ${ist().slice(0, 16).replace("T", " ")}`);
    return { ok: true };
  } catch (e) { set("live_numbers_status", `Failed ${ist().slice(0, 16).replace("T", " ")}: ${e.message}`); return { ok: false, error: e.message }; }
}

router.get("/", requireAuth, requireLeadership, (req, res) => {
  let data = null; try { data = JSON.parse(get("live_numbers") || "null"); } catch {}
  res.json({ configured: !!get("live_feed_url"), data, status: get("live_numbers_status") });
});
router.get("/config", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  res.json({ url: get("live_feed_url"), status: get("live_numbers_status"), script: feedScript() });
});
router.put("/config", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const url = String(req.body?.url || "").trim();
  if (url && !/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) return res.status(400).json({ error: "That is not the Apps Script web app link. It ends with /exec" });
  set("live_feed_url", url); res.json({ ok: true });
});
router.post("/refresh", requireAuth, async (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const r = await refreshLive(); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
});
export default router;
