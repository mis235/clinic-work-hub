import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { AGENTS, getAgent } from "../agents/index.js";

const router = Router();

// GET /api/advisors — the picker list. No system prompts sent here, just enough
// to render cards (id, name, mission, category).
router.get("/", requireAuth, requirePermission("advisors:use"), (req, res) => {
  res.json(AGENTS.map(({ id, name, category, mission }) => ({ id, name, category, mission })));
});

// POST /api/advisors/:id/chat
// body: { messages: [{ role: 'user'|'assistant', content: string }] }
// This is advisory only — it calls Claude with the agent's exact system prompt
// and returns text. It never writes to any other table in this app; a human
// always has to act on what it recommends. Requires ANTHROPIC_API_KEY in .env.
router.post("/:id/chat", requireAuth, requirePermission("advisors:use"), async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Unknown advisor" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "AI Advisors aren't configured yet. Add ANTHROPIC_API_KEY to backend/.env to enable this feature.",
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 1500,
        system: agent.systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: data?.error?.message || "Anthropic API request failed" });
    }

    const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
    res.json({ reply: text });
  } catch (err) {
    res.status(502).json({ error: `Could not reach Anthropic API: ${err.message}` });
  }
});

export default router;
