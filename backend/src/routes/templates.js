import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

// GET /api/templates — used to populate the "assign from template" picker.
// Only people who can assign tasks need to see these.
router.get("/", requireAuth, requirePermission("task:assign"), (req, res) => {
  const rows = db
    .prepare("SELECT id, category, title, default_notes FROM checklist_templates ORDER BY category, title")
    .all();
  res.json(rows);
});

export default router;
