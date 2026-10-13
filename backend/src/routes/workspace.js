// Department workspaces: each department keeps its own sheets, dashboards, apps and links in one place.
// Admin / managers can see and edit every department; staff work inside their own department's workspace.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS workspace_items (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link',      -- sheet | dashboard | doc | app | link
  url TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
const KINDS = ["sheet", "dashboard", "doc", "app", "link"];
const isLead = (u) => u.roleName === "admin" || u.roleName === "manager";
const myDept = (u) => db.prepare("SELECT department_id FROM users WHERE id = ?").get(u.userId)?.department_id || null;
const canUse = (u, deptId) => isLead(u) || (deptId && myDept(u) === deptId);

// First use only: put the clinic's existing sheets and dashboard into the Management workspace (the MIS team's desk).
// A marker row stops it coming back after someone deletes them. (Runs lazily because departments are created after this file loads.)
db.exec("CREATE TABLE IF NOT EXISTS workspace_meta (key TEXT PRIMARY KEY, value TEXT)");
function ensureSeed() {
  if (db.prepare("SELECT 1 FROM workspace_meta WHERE key = 'seeded'").get()) return;
  if (!db.prepare("SELECT 1 FROM departments LIMIT 1").get()) return;
  db.prepare("INSERT INTO workspace_meta (key, value) VALUES ('seeded', '1')").run();
  const mgmt = db.prepare("SELECT id FROM departments WHERE name = 'Management'").get();
  if (mgmt) {
    const ins = db.prepare("INSERT INTO workspace_items (id, department_id, title, kind, url, note, sort_order) VALUES (?,?,?,?,?,?,?)");
    [
      ["Checklist Dashboard", "dashboard", "https://script.google.com/a/macros/drnishitaranka.com/s/AKfycbykM1B3b4PZGN7wdWn4lxE6GjLnl-uwtrhgwtldX4m4HzVZd4XKoJW2L-CgOZqded8/exec?dashboard=1", "Live checklist dashboard (Google Apps Script)"],
      ["Front Desk Checklist Log", "sheet", "https://docs.google.com/spreadsheets/d/1oSIqljPcJAFlGQSB29OdhvwQb78IMgNAZ2HL6mI_oi8/edit", "Every submitted checklist"],
      ["Front Desk MIS Score", "sheet", "https://docs.google.com/spreadsheets/d/1naUwmiAqR1B24UftLa8n8NebE2eY0Gn3o4z0k55cLWk/edit", "Front desk scoring sheet"],
      ["Clinic Operations Checklist Tracker", "sheet", "https://docs.google.com/spreadsheets/d/1Rimx-pvy1N3tEF6cC6Tma0TKbFrwi3l21FeJVkpPpTo/edit", "Tracker for operations checklists"],
    ].forEach(([t, k, u, n], i) => ins.run(randomUUID(), mgmt.id, t, k, u, n, i));
  }
}

const list = (deptId) => (ensureSeed(), db.prepare(
  `SELECT w.id, w.title, w.kind, w.url, w.note, w.sort_order, w.created_at, u.name AS added_by_name
   FROM workspace_items w LEFT JOIN users u ON u.id = w.added_by WHERE w.department_id = ? ORDER BY w.sort_order, w.created_at`).all(deptId));

// Which department does this person work in?  (staff land here)
router.get("/me", requireAuth, (req, res) => {
  const id = myDept(req.user);
  if (!id) return res.json({ department: null, items: [], canEdit: false });
  res.json({ department: db.prepare("SELECT id, name FROM departments WHERE id = ?").get(id), items: list(id), canEdit: true });
});

router.get("/:deptId", requireAuth, (req, res) => {
  const dept = db.prepare("SELECT id, name FROM departments WHERE id = ?").get(req.params.deptId);
  if (!dept) return res.status(404).json({ error: "Not found" });
  if (!canUse(req.user, dept.id)) return res.status(403).json({ error: "This is another department's workspace" });
  res.json({ department: dept, items: list(dept.id), canEdit: true });
});

function clean(b) {
  const title = String(b.title || "").trim().slice(0, 80), url = String(b.url || "").trim();
  if (!title) return { error: "Give it a name" };
  if (!/^https?:\/\//i.test(url)) return { error: "The address must start with http:// or https://" };
  return { title, url, kind: KINDS.includes(b.kind) ? b.kind : "link", note: b.note ? String(b.note).slice(0, 160) : null };
}

router.post("/:deptId", requireAuth, (req, res) => {
  const dept = db.prepare("SELECT id FROM departments WHERE id = ?").get(req.params.deptId);
  if (!dept) return res.status(404).json({ error: "Not found" });
  if (!canUse(req.user, dept.id)) return res.status(403).json({ error: "This is another department's workspace" });
  const c = clean(req.body || {});
  if (c.error) return res.status(400).json({ error: c.error });
  const next = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 n FROM workspace_items WHERE department_id = ?").get(dept.id).n);
  const id = randomUUID();
  db.prepare("INSERT INTO workspace_items (id, department_id, title, kind, url, note, sort_order, added_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, dept.id, c.title, c.kind, c.url, c.note, next, req.user.userId);
  res.status(201).json({ id });
});

router.patch("/item/:id", requireAuth, (req, res) => {
  const it = db.prepare("SELECT * FROM workspace_items WHERE id = ?").get(req.params.id);
  if (!it) return res.status(404).json({ error: "Not found" });
  if (!canUse(req.user, it.department_id)) return res.status(403).json({ error: "This is another department's workspace" });
  const c = clean({ ...it, ...(req.body || {}) });
  if (c.error) return res.status(400).json({ error: c.error });
  db.prepare("UPDATE workspace_items SET title = ?, kind = ?, url = ?, note = ? WHERE id = ?").run(c.title, c.kind, c.url, c.note, it.id);
  res.json({ ok: true });
});

router.delete("/item/:id", requireAuth, (req, res) => {
  const it = db.prepare("SELECT * FROM workspace_items WHERE id = ?").get(req.params.id);
  if (!it) return res.status(404).json({ error: "Not found" });
  if (!canUse(req.user, it.department_id)) return res.status(403).json({ error: "This is another department's workspace" });
  db.prepare("DELETE FROM workspace_items WHERE id = ?").run(it.id);
  res.json({ ok: true });
});

export default router;
