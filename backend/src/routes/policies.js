import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();


// The clinic's SOP documents in Google Drive: added once (skipped when a title is already there).
const DRIVE = (id) => `https://drive.google.com/file/d/${id}/view`;
const DRIVE_SOPS = [
  ["SOP — Front Desk", "Appointment Booking & Scheduling SOP", "11hnwd44MTZpXmR4v0vOJelee6lbCU0GU"],
  ["SOP — Front Desk", "Appointment Cancellation SOP", "1W_lYYr8r0QklQX395rsQL-cQw29NDjzv"],
  ["SOP — Front Desk", "Existing Patient with Appointment SOP", "1-Dqs_QZSiExTr61MqA7MFPM9ZlMEAggU"],
  ["SOP — Front Desk", "New Patient with Appointment SOP", "1fTdTgzYEhQLDv3e2oUncOFl7o6dSSSGg"],
  ["SOP — Front Desk", "Same Day Appointment Slot Request SOP", "1Tk4pdujRN5UThpLJJ1IUBsNIdlQ5vWfu"],
  ["SOP — Front Desk", "Pre-Consultation Formalities SOP", "1x_9x4frbK7oPxCUScPF8Cft12CPBnxqL"],
  ["SOP — Front Desk", "Patient Enquiry Management Process SOP", "1dHq-d897pFXx1K5Quu4V2Yk4DyAXkCuo"],
  ["SOP — Management", "Internal Booking (Family & Friends) Approval SOP", "1hj1wrIXQGlqzubi6f3G3UUEiVChfDQlD"],
  ["SOP — General", "Clinic Advance Fee and Cancellation SOPs", "1U0y_tEEE8ggm8ZHmSmxWhCrcEqP1-Htd"],
  ["SOP — Pharmacy", "Pharmacy SOP", "1if6C7fsVNuTg93bbw3vQt5nB6qFmITMa"],
  ["SOP — Counsellor & Manager", "Counsellor & Manager SOP", "1IvB-gyNBpjThUx91ZxJWBaY484pzwEHZ"],
  ["SOP — Accounts", "Accounts SOP", "1ootuQ9eTFZnNEH_2nsBbnu5SkD-myBgQ"],
  ["SOP — Therapist", "Hydrafacial SOP", "1ZWmdnCaEGlSIXAuQLQE9lVByolhVdgEE"],
  ["SOP — Therapist", "SOPs & Protocols (all procedures)", "1k5gB81MC3fOC1aqDv5cNGo3WXEm91SmP"],
  ["SOP — General", "Procedures Overview SOPs (sheet)", "1Uu-l7zhOJTfHW901J8rto1hO8WV_Ywqe"],
];
try {
  const has = db.prepare("SELECT 1 FROM policies WHERE title = ?"), ins = db.prepare("INSERT INTO policies (id, title, category, body, version) VALUES (?, ?, ?, ?, 1)");
  for (const [cat, title, id] of DRIVE_SOPS) if (!has.get(title)) ins.run(randomUUID(), title, cat, `Open the full document:\n${DRIVE(id)}\n\nPlease read it carefully, then tap "I Have Read This".`);
} catch {}

// The clinic's written SOPs (organisation structure + Front Office operating manual), added once; a title already there is skipped.
try {
  const docs = JSON.parse(fs.readFileSync(new URL("../sopDocs.json", import.meta.url), "utf8"));
  const has = db.prepare("SELECT 1 FROM policies WHERE title = ? AND category = ?"), ins = db.prepare("INSERT INTO policies (id, title, category, body, version) VALUES (?, ?, ?, ?, 1)");
  for (const d of docs) if (!has.get(d.title, d.category)) ins.run(randomUUID(), d.title, d.category, d.body);
} catch (e) { console.warn("SOP documents not loaded:", e.message); }

// An SOP is "for" a person when its category/title names their department or job title
// (e.g. "SOP — Front Desk" for someone in the Front Desk department). General SOPs (no team named) are for everyone.
const isSopRow = (p) => /sop|procedure/i.test(`${p.category} ${p.title}`);
const words = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["and", "the", "for", "sop", "procedure", "procedures"].includes(w));
export function sopsForRole(department, roleTitle) {
  const keys = [...new Set([...words(department), ...words(roleTitle)])];
  const all = db.prepare("SELECT * FROM policies ORDER BY category, title").all().filter(isSopRow);
  return all.filter((p) => {
    const w = words(`${p.category} ${p.title}`);
    return w.length === 0 || keys.some((k) => w.includes(k)) || /\ball\b|general|everyone|common/i.test(p.category);
  });
}

// GET /api/policies — everyone can read policies, and see whether THEY personally
// have acknowledged the current version of each one.
router.get("/", requireAuth, (req, res) => {
  const policies = db.prepare("SELECT * FROM policies ORDER BY category, title").all();
  const me = db.prepare("SELECT u.designation, d.name AS dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?").get(req.user.userId);
  const mine = new Set(sopsForRole(me?.dept, me?.designation).map((p) => p.id));
  const myAcks = db
    .prepare("SELECT policy_id, policy_version FROM policy_acknowledgments WHERE user_id = ?")
    .all(req.user.userId);
  const ackMap = new Map(myAcks.map((a) => [`${a.policy_id}:${a.policy_version}`, true]));

  res.json(
    policies.map((p) => ({
      ...p,
      acknowledgedByMe: ackMap.has(`${p.id}:${p.version}`),
      forMyRole: isSopRow(p) && mine.has(p.id),
    }))
  );
});

// POST /api/policies/:id/acknowledge — the reader confirms they've read the CURRENT version.
router.post("/:id/acknowledge", requireAuth, (req, res) => {
  const policy = db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  if (!policy) return res.status(404).json({ error: "Policy not found" });

  db.prepare(
    `INSERT OR IGNORE INTO policy_acknowledgments (id, policy_id, policy_version, user_id)
     VALUES (?, ?, ?, ?)`
  ).run(randomUUID(), policy.id, policy.version, req.user.userId);

  res.json({ ok: true });
});

// GET /api/policies/:id/status — admin/manager view: who has and hasn't acknowledged
// the CURRENT version. This is what makes "everyone has read the policy" verifiable
// instead of assumed.
router.get("/:id/status", requireAuth, requirePermission("reports:view"), (req, res) => {
  const policy = db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  if (!policy) return res.status(404).json({ error: "Policy not found" });

  const allUsers = db
    .prepare(
      `SELECT u.id, u.name, d.name AS department FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.active = 1`
    )
    .all();
  const acks = db
    .prepare("SELECT user_id, acknowledged_at FROM policy_acknowledgments WHERE policy_id = ? AND policy_version = ?")
    .all(policy.id, policy.version);
  const ackMap = new Map(acks.map((a) => [a.user_id, a.acknowledged_at]));

  res.json({
    policy: { id: policy.id, title: policy.title, version: policy.version },
    staff: allUsers.map((u) => ({
      ...u,
      acknowledged: ackMap.has(u.id),
      acknowledgedAt: ackMap.get(u.id) || null,
    })),
  });
});

// POST /api/policies — admin creates a new policy (requires policies:manage)
router.post("/", requireAuth, requirePermission("policies:manage"), (req, res) => {
  const { title, category, body } = req.body || {};
  if (!title || !category || !body) return res.status(400).json({ error: "title, category, body are required" });
  const id = randomUUID();
  db.prepare("INSERT INTO policies (id, title, category, body, version) VALUES (?, ?, ?, ?, 1)").run(id, title, category, body);
  res.status(201).json({ id, title, category, version: 1 });
});

// POST /api/policies/bulk — { items: [{ category, title, url }] }: one entry per Drive document; skips titles already there.
router.post("/bulk", requireAuth, requirePermission("policies:manage"), (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  let added = 0, skipped = 0;
  const has = db.prepare("SELECT 1 FROM policies WHERE title = ? AND category = ?");
  const ins = db.prepare("INSERT INTO policies (id, title, category, body, version) VALUES (?, ?, ?, ?, 1)");
  db.transaction(() => {
    for (const it of items) {
      const category = String(it?.category || "").trim().slice(0, 60), title = String(it?.title || "").trim().slice(0, 160), url = String(it?.url || "").trim();
      if (!category || !title || !/^https?:\/\//i.test(url) || has.get(title, category)) { skipped++; continue; }
      ins.run(randomUUID(), title, category, `Open the full document:\n${url}\n\nPlease read it carefully, then tap "I Have Read This".`);
      added++;
    }
  })();
  res.json({ added, skipped });
});

// PATCH /api/policies/:id — admin edits; bumps the version, which resets everyone's
// acknowledgment for this policy (they need to re-read and re-acknowledge).
router.patch("/:id", requireAuth, requirePermission("policies:manage"), (req, res) => {
  const policy = db.prepare("SELECT * FROM policies WHERE id = ?").get(req.params.id);
  if (!policy) return res.status(404).json({ error: "Policy not found" });
  const { title, category, body } = req.body || {};
  db.prepare(
    `UPDATE policies SET title = ?, category = ?, body = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(title || policy.title, category || policy.category, body || policy.body, policy.id);
  res.json({ ok: true });
});

export default router;
