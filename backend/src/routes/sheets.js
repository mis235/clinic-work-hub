// Sheets Dashboard: leadership registers Google Sheets (by link) and the app shows each one as a clean dashboard
// (totals, top categories, monthly trend, searchable table). The sheet must be shared as "Anyone with the link can view".
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { accessFor } from "../access.js";
import { normalizeSheetUrl, parseCsv } from "./shiftChecklist.js";

db.exec(`CREATE TABLE IF NOT EXISTS dash_sheets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', url TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
)`);
const router = Router();
const canView = (req) => req.user.roleName === "admin" || !!accessFor(req.user.userId, req.user.roleName).leadership;
const guard = (req, res, next) => (canView(req) ? next() : res.status(403).json({ error: "Only the admin and leadership team can see Sheets" }));
const isSheetUrl = (u) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/.test(String(u || "").trim());

router.get("/", requireAuth, guard, (req, res) => {
  res.json({ sheets: db.prepare("SELECT id, title, category, url FROM dash_sheets ORDER BY category, sort_order, title").all(), canEdit: req.user.roleName === "admin" });
});
router.post("/", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [req.body];
  let added = 0, skipped = 0;
  for (const it of items) {
    const title = String(it?.title || "").trim().slice(0, 120), url = String(it?.url || "").trim(), category = String(it?.category || "General").trim().slice(0, 60) || "General";
    if (!title || !isSheetUrl(url)) { skipped++; continue; }
    db.prepare("INSERT INTO dash_sheets (id, title, category, url) VALUES (?,?,?,?)").run(randomUUID(), title, category, url); added++;
  }
  if (!added) return res.status(400).json({ error: "Give a name and a Google Sheets link (docs.google.com/spreadsheets/…)" });
  res.status(201).json({ added, skipped });
});
router.put("/:id", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  const title = String(req.body?.title || "").trim().slice(0, 120), url = String(req.body?.url || "").trim(), category = String(req.body?.category || "General").trim().slice(0, 60) || "General";
  if (!title || !isSheetUrl(url)) return res.status(400).json({ error: "Give a name and a Google Sheets link" });
  const r = db.prepare("UPDATE dash_sheets SET title=?, url=?, category=? WHERE id=?").run(title, url, category, req.params.id);
  cache.delete(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});
router.delete("/:id", requireAuth, (req, res) => {
  if (req.user.roleName !== "admin") return res.status(403).json({ error: "Admin only" });
  db.prepare("DELETE FROM dash_sheets WHERE id = ?").run(req.params.id); cache.delete(req.params.id); res.json({ ok: true });
});

const num = (s) => { const t = String(s ?? "").replace(/[₹,%\s]/g, "").replace(/,/g, ""); return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const dateOf = (s) => { const t = String(s || "").trim(); let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(t); if (m) return `${m[3]}-${m[2].padStart(2, "0")}`; m = /^(\d{4})-(\d{2})-\d{2}/.exec(t); return m ? `${m[1]}-${m[2]}` : null; };

export function profile(text) {
  const table = parseCsv(String(text).replace(/^﻿/, "")).filter((r) => r.some((c) => String(c).trim()));
  if (!table.length) return { columns: [], rows: [], total: 0 };
  // header = the first row that has at least 2 filled cells
  const hi = Math.max(0, table.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2));
  const head = table[hi].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  const body = table.slice(hi + 1);
  const columns = head.map((name, i) => {
    const vals = body.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    const ns = vals.map(num).filter((x) => x != null), ds = vals.map(dateOf).filter(Boolean);
    const c = { name, filled: vals.length };
    if (vals.length && ns.length / vals.length > 0.8) { c.type = "number"; c.sum = ns.reduce((a, b) => a + b, 0); c.avg = c.sum / ns.length; c.min = Math.min(...ns); c.max = Math.max(...ns); }
    else if (vals.length && ds.length / vals.length > 0.8) { c.type = "date"; const by = {}; ds.forEach((d) => (by[d] = (by[d] || 0) + 1)); c.months = Object.entries(by).sort().slice(-12).map(([m, n]) => ({ m, n })); }
    else { const by = {}; vals.forEach((v) => (by[v] = (by[v] || 0) + 1)); const keys = Object.keys(by); c.type = keys.length <= 30 && keys.length < vals.length ? "category" : "text"; c.distinct = keys.length; if (c.type === "category") c.top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => ({ v, n })); }
    return c;
  });
  return { columns, rows: body.slice(0, 1000).map((r) => head.map((_, i) => String(r[i] ?? "").slice(0, 200))), total: body.length };
}

const cache = new Map(); // id -> { at, data }
router.get("/:id/data", requireAuth, guard, async (req, res) => {
  const s = db.prepare("SELECT * FROM dash_sheets WHERE id = ?").get(req.params.id); if (!s) return res.status(404).json({ error: "Not found" });
  const hit = cache.get(s.id);
  if (hit && Date.now() - hit.at < 50 * 1000 && !req.query.fresh) return res.json(hit.data);
  try {
    const r = await fetch(normalizeSheetUrl(s.url), { redirect: "follow", signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (!r.ok || /<html/i.test(text.slice(0, 500))) return res.status(502).json({ error: "This sheet is private. In Google Sheets press Share, then General access, then “Anyone with the link”, then Viewer. Then press Refresh." });
    const data = { id: s.id, title: s.title, url: s.url, fetchedAt: new Date().toISOString(), ...profile(text) };
    cache.set(s.id, { at: Date.now(), data });
    res.json(data);
  } catch (e) { res.status(502).json({ error: "Could not read the sheet: " + e.message }); }
});
export default router;
