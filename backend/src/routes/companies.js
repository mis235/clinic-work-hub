import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM companies ORDER BY name").all());
});

router.post("/", requireAuth, requirePermission("payroll:manage"), (req, res) => {
  const { name, address } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = randomUUID();
  db.prepare("INSERT INTO companies (id, name, address) VALUES (?, ?, ?)").run(id, name, address || null);
  res.status(201).json({ id, name, address });
});

export default router;
