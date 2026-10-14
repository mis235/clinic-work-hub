import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { isHr, leaveSummary, settings as hrSettings, birthdays, lateDays } from "./leave.js";

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

const todayIST = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const list = (rows, f) => rows.map((r) => "• " + f(r)).join("\n");
const SUGGESTED_QUESTIONS = [
  "How many leaves do I have left?",
  "Who is on leave today?",
  "Which leave requests are waiting?",
  "Upcoming birthdays",
  "Who was late this month?",
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

  // 0) HR answers: leave, birthdays, late arrivals, staff list — straight from the live data.
  const me = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
  const hr = isHr(userId, req.user.roleName), lead = hr || req.user.roleName === "manager";
  const t = todayIST(), month = t.slice(0, 7);
  if (/birthday|born/.test(m)) {
    if (!lead) return res.json({ reply: "Birthdays are shown to HR and the admin. You can ask them.", source: "data" });
    const b = birthdays(30);
    if (!b.length) return res.json({ reply: "No birthdays in the next 30 days (or no dates of birth are saved yet — add them in Staff → Edit).", source: "data" });
    const today = b.filter((x) => x.inDays === 0);
    return res.json({ reply: (today.length ? `🎂 Today: ${today.map((x) => x.name).join(", ")}\n\n` : "") + "Upcoming (30 days):\n" + list(b.filter((x) => x.inDays > 0), (x) => `${x.name} — ${dmy(x.next)} (${x.inDays === 1 ? "tomorrow" : "in " + x.inDays + " days"})`), source: "data" });
  }
  if (/leave|day off|holiday/.test(m) && /pending|waiting|approval|approve|request/.test(m) && lead) {
    if (!hr) return res.json({ reply: "Leave approvals are handled by HR.", source: "data" });
    const rows = db.prepare("SELECT l.from_date, l.to_date, l.days, l.reason_type, u.name FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.status = 'pending' ORDER BY l.from_date").all();
    return res.json({ reply: rows.length ? `${rows.length} leave request${rows.length === 1 ? " is" : "s are"} waiting for approval:\n` + list(rows, (r) => `${r.name}: ${dmy(r.from_date)}${r.to_date !== r.from_date ? " – " + dmy(r.to_date) : ""} (${r.days} day, ${r.reason_type})`) + "\n\nOpen Leave & HR to approve." : "No leave requests are waiting. 🎉", source: "data" });
  }
  if (/who.*(on leave|leave|absent|off)|on leave|leave today/.test(m) && lead) {
    const rows = db.prepare("SELECT u.name, l.to_date FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ?").all(t, t);
    return res.json({ reply: rows.length ? "On approved leave today:\n" + list(rows, (r) => `${r.name} (until ${dmy(r.to_date)})`) : "Nobody is on approved leave today.", source: "data" });
  }
  if (/late/.test(m) && /who|everyone|staff|team|this month|list/.test(m) && lead) {
    const s = hrSettings();
    const rows = db.prepare("SELECT id, name FROM users WHERE active = 1").all().map((u) => ({ name: u.name, n: lateDays(u.id, month).length })).filter((r) => r.n).sort((a, b) => b.n - a.n);
    return res.json({ reply: rows.length ? `Late arrivals this month (more than ${s.late_grace_min} min after shift start; every ${s.late_limit} lates = ₹${s.late_fine} fine):\n` + list(rows, (r) => `${r.name}: ${r.n}`) : "No late arrivals this month.", source: "data" });
  }
  if (/(my|how many).*(leave|leaves)|leave (balance|left|status)|leaves? (left|taken|do i)/.test(m)) {
    const l = leaveSummary(userId, month), s = hrSettings();
    const last = db.prepare("SELECT from_date, to_date, status FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId);
    return res.json({ reply: `This month you have ${l.allowed} free casual leave day${l.allowed === 1 ? "" : "s"}. Taken: ${l.taken}. Free days left: ${l.freeLeft}.${l.lopDays ? ` ${l.lopDays} extra day(s) will cut ${l.lopDays} day's salary.` : ` Each day beyond ${l.allowed} cuts one day's salary.`}${l.pending ? ` ${l.pending} day(s) waiting for approval.` : ""}${last ? ` Your latest request (${dmy(last.from_date)}) is ${last.status}.` : ""} Apply in Leave & HR.`, source: "data" });
  }
  if (/(who|how many|list).*(staff|employee|team|people)|staff list|clinic staff/.test(m)) {
    if (!lead) return res.json({ reply: "The full staff list is shown to managers, HR and admin.", source: "data" });
    const rows = db.prepare("SELECT d.name AS dept, COUNT(*) n FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.active = 1 GROUP BY d.name ORDER BY n DESC").all();
    const total = rows.reduce((a, r) => a + r.n, 0);
    return res.json({ reply: `${total} active staff:\n` + list(rows, (r) => `${r.dept || "No department"}: ${r.n}`), source: "data" });
  }
  if (/\bfine|grooming/.test(m)) {
    const rows = db.prepare("SELECT fine_date, category, amount FROM fines WHERE user_id = ? AND substr(fine_date,1,7) = ? ORDER BY fine_date").all(userId, month);
    return res.json({ reply: rows.length ? `Your fines this month (come off your payslip):\n` + list(rows, (r) => `${dmy(r.fine_date)} — ${r.category.replace("_", " ")} — ₹${r.amount}`) : "You have no fines this month. 👍", source: "data" });
  }

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
