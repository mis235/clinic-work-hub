import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const router = Router();

// ---------------------------------------------------------------------------
// Staff Assistant — a chatbot every signed-in person can use (admin, manager,
// and staff alike), unlike the 7 AI Advisors (which are management-strategy
// consultants gated to admin/manager). This one answers the everyday
// questions a staff member actually has: "how many tasks do I have left",
// "am I checked in today", "what's the leave policy", "who do I ask about
// my payslip". It works with zero configuration (pure rule-based answers
// pulled straight from this clinic's own data), and gets noticeably more
// conversational if ANTHROPIC_API_KEY is set in .env — but never requires it.
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS = [
  "How many tasks do I have open?",
  "Did I check in today?",
  "What's the leave policy?",
  "How do I mark attendance?",
  "Who do I ask about my payslip?",
  "What policies haven't I acknowledged yet?",
];

router.get("/faqs", requireAuth, requirePermission("assistant:use"), (req, res) => {
  res.json({ suggestions: SUGGESTED_QUESTIONS });
});

function myTaskLine(userId) {
  const rows = db.prepare("SELECT status FROM tasks WHERE user_id = ?").all(userId);
  const open = rows.filter((r) => r.status !== "done").length;
  const done = rows.filter((r) => r.status === "done").length;
  if (rows.length === 0) return "You don't have any tasks assigned right now.";
  return `You have ${open} open task${open === 1 ? "" : "s"} and ${done} done, out of ${rows.length} total. Check "My checklist" or "Tracker" for the full list.`;
}

function myAttendanceLine(userId) {
  const today = db
    .prepare(
      `SELECT type, recorded_at FROM attendance WHERE user_id = ? AND date(recorded_at) = date('now') ORDER BY recorded_at DESC LIMIT 1`
    )
    .get(userId);
  const monthCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM attendance WHERE user_id = ? AND type = 'check_in' AND recorded_at >= datetime('now','start of month')`
    )
    .get(userId).n;
  if (!today) {
    return `You haven't checked in today yet. You've checked in ${monthCount} day${monthCount === 1 ? "" : "s"} so far this month. Use the biometric attendance button on your dashboard to check in.`;
  }
  return `You ${today.type === "check_in" ? "checked in" : "checked out"} today at ${new Date(today.recorded_at).toLocaleTimeString()}. You've checked in ${monthCount} day${monthCount === 1 ? "" : "s"} this month.`;
}

function policyGapLine(userId) {
  const policies = db.prepare("SELECT id, title, version FROM policies").all();
  const acked = new Set(
    db
      .prepare("SELECT policy_id, policy_version FROM policy_acknowledgments WHERE user_id = ?")
      .all(userId)
      .map((a) => `${a.policy_id}:${a.policy_version}`)
  );
  const missing = policies.filter((p) => !acked.has(`${p.id}:${p.version}`)).map((p) => p.title);
  if (missing.length === 0) return "You're up to date — you've acknowledged every current policy.";
  return `You still need to read and acknowledge: ${missing.join(", ")}. Open the Policies tab to do that.`;
}

function policyBodyFor(keyword) {
  const policy = db
    .prepare("SELECT title, body FROM policies WHERE title LIKE ? OR category LIKE ? ORDER BY title LIMIT 1")
    .get(`%${keyword}%`, `%${keyword}%`);
  if (!policy) return null;
  return `**${policy.title}**\n\n${policy.body}`;
}

// POST /api/assistant/ask  { message }
router.post("/ask", requireAuth, requirePermission("assistant:use"), async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });

  const m = message.toLowerCase();
  const userId = req.user.userId;

  // 1) Fast, always-correct answers straight from this clinic's live data —
  // no AI involved, so these work even with no API key configured, and they
  // can never hallucinate a wrong task count or attendance status.
  if (/task|checklist|to-?do|pending|overdue/.test(m)) {
    return res.json({ reply: myTaskLine(userId), source: "data" });
  }
  if (/attend|check.?in|check.?out|late|punctual/.test(m)) {
    return res.json({ reply: myAttendanceLine(userId), source: "data" });
  }
  if (/acknowledg|haven'?t read|not read|pending polic/.test(m)) {
    return res.json({ reply: policyGapLine(userId), source: "data" });
  }
  if (/leave|vacation|day off/.test(m)) {
    const body = policyBodyFor("Leave");
    return res.json({ reply: body || "I couldn't find a Leave policy yet — ask your manager.", source: "policy" });
  }
  if (/payslip|salary|pay\b|payroll/.test(m)) {
    return res.json({
      reply: "Payslips are generated automatically each month and emailed to you. If you need a copy now, ask an admin to regenerate it from the Payroll tab, or check your email for the PDF.",
      source: "data",
    });
  }
  if (/grievance|complain|escalat/.test(m)) {
    const body = policyBodyFor("Grievance");
    return res.json({ reply: body || "Ask your manager, or an admin, directly.", source: "policy" });
  }
  if (/conduct|dress code|behav/.test(m)) {
    const body = policyBodyFor("Conduct");
    return res.json({ reply: body || "Check the Policies tab for the Code of Conduct.", source: "policy" });
  }

  // 2) Anything else: use Claude if configured, grounded in this clinic's own
  // policies so it doesn't invent clinic-specific facts it was never given.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const policies = db.prepare("SELECT title, body FROM policies ORDER BY category, title").all();
      const policyDump = policies.map((p) => `### ${p.title}\n${p.body}`).join("\n\n");
      const me = db.prepare("SELECT name, department_id FROM users WHERE id = ?").get(userId);
      const dept = db.prepare("SELECT name FROM departments WHERE id = ?").get(me?.department_id)?.name;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
          max_tokens: 500,
          system: `You are the internal Staff Assistant for Dr. Nishita's Clinic Work Hub, talking to ${me?.name || "a staff member"} (${dept || "unknown department"}). Answer only using the clinic policies below and general, harmless workplace guidance. If something isn't covered by these policies, say you're not sure and suggest they ask their manager or admin — never invent a clinic-specific rule, number, or figure. Keep answers short (2-5 sentences).\n\n${policyDump}`,
          messages: [{ role: "user", content: message }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "Anthropic API request failed");
      const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
      return res.json({ reply: text, source: "ai" });
    } catch (err) {
      return res.json({
        reply: `I couldn't reach the AI assistant just now (${err.message}). Try one of the suggested questions, or ask your manager directly.`,
        source: "error",
      });
    }
  }

  // 3) No API key configured — still give something useful instead of a dead end.
  res.json({
    reply: "I can help directly with tasks, attendance, and policies — try asking \"how many tasks do I have\" or \"what's the leave policy\". For anything else, an admin can enable richer answers by adding ANTHROPIC_API_KEY in the backend .env.",
    source: "fallback",
  });
});

export default router;
