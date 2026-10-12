import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

// GET /api/policies — everyone can read policies, and see whether THEY personally
// have acknowledged the current version of each one.
router.get("/", requireAuth, (req, res) => {
  const policies = db.prepare("SELECT * FROM policies ORDER BY category, title").all();
  const myAcks = db
    .prepare("SELECT policy_id, policy_version FROM policy_acknowledgments WHERE user_id = ?")
    .all(req.user.userId);
  const ackMap = new Map(myAcks.map((a) => [`${a.policy_id}:${a.policy_version}`, true]));

  res.json(
    policies.map((p) => ({
      ...p,
      acknowledgedByMe: ackMap.has(`${p.id}:${p.version}`),
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
