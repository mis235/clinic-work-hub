// One-command production smoke test:  cd backend && npm test
// Boots the server on a throwaway database and checks the flows the clinic depends on.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 4590 + Math.floor(Math.random() * 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, JWT_SECRET: "test-secret-for-smoke-tests-1234567890", ADMIN_EMAIL: "admin@test.local", ADMIN_PASSWORD: "testpass123", DISABLE_CRON: "true", NODE_ENV: "test" };
const server = spawn("node", ["src/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const base = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${cond ? "" : "  " + extra}`); };
const call = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/health"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; }

try {
  console.log("== Clinic Work Hub smoke test ==");
  ok("server starts on an empty database", await waitUp(), log.slice(-500));
  const h = await call("GET", "/health"); ok("health check reports db ok", h.body?.db === "ok");

  const noTok = await call("GET", "/api/tasks"); ok("API rejects requests without a login", noTok.status === 401);
  const bad = await call("POST", "/api/auth/login", { email: "admin@test.local", password: "wrong" }); ok("wrong admin password rejected", bad.status === 401);

  const a = await call("POST", "/api/auth/login", { email: "admin@test.local", password: "testpass123" });
  ok("admin can sign in", a.status === 200 && !!a.body?.token, JSON.stringify(a.body));
  const admin = a.body?.token;

  const users = (await call("GET", "/api/users/full", null, admin)).body || [];
  ok("seed loaded staff", users.length > 5, `got ${users.length}`);
  const staff = users.find((u) => u.role && u.role !== "admin" && u.role !== "manager") || users.find((u) => u.role !== "admin");
  const s = await call("POST", "/api/auth/login", { userId: staff.id, pin: "1234" });
  ok("staff can sign in with starter PIN", s.status === 200, JSON.stringify(s.body));
  ok("staff is forced to change the starter PIN", s.body?.user?.mustChangePin === true);
  const stoken = s.body?.token;

  ok("staff blocked from admin status", (await call("GET", "/api/admin/status", null, stoken)).status === 403);
  ok("staff blocked from onboarding list", (await call("GET", "/api/users/onboarding", null, stoken)).status === 403);
  const st = await call("GET", "/api/admin/status", null, admin); ok("admin status works", st.status === 200 && st.body?.users > 5);

  // PIN change
  const cp = await call("POST", "/api/users/me/pin", { currentPin: "1234", newPin: "7391" }, stoken);
  ok("staff can change PIN", cp.status === 200, JSON.stringify(cp.body));
  ok("old PIN no longer works", (await call("POST", "/api/auth/login", { userId: staff.id, pin: "1234" })).status === 401);
  ok("new PIN works", (await call("POST", "/api/auth/login", { userId: staff.id, pin: "7391" })).status === 200);

  // Shift checklist autosave
  // Find a staff member whose role has a checklist assigned.
  let ctoken = null, tpl = { status: 404 };
  for (const u of users.filter((x) => x.role !== "admin" && x.id !== staff.id)) {
    const lg = await call("POST", "/api/auth/login", { userId: u.id, pin: "1234" });
    if (lg.status !== 200) continue;
    const t = await call("GET", "/api/shift-checklist/template", null, lg.body.token);
    if (t.status === 200) { ctoken = lg.body.token; tpl = t; break; }
  }
  if (tpl.status === 200) {
    const items = tpl.body.sections.flatMap((x) => x.items.map((t) => ({ section: x.section, text: t, done: false })));
    items.slice(0, 3).forEach((i) => (i.done = true));
    const sv = await call("POST", "/api/shift-checklist/progress", { shift: "Morning", items, metrics: null }, ctoken);
    ok("checklist progress autosaves", sv.status === 200 && sv.body?.status === "in_progress", JSON.stringify(sv.body));
    const td = await call("GET", "/api/shift-checklist/today", null, ctoken);
    ok("saved ticks come back after reload", td.body?.[0]?.items?.filter((i) => i.done).length === 3);
    const mon = await call("GET", "/api/shift-checklist/submissions", null, admin);
    ok("admin monitor sees the in-progress checklist", JSON.stringify(mon.body).includes("in_progress"));
  } else ok("staff role has a checklist template", false, `status ${tpl.status}`);

  // Onboarding
  const ob = await call("GET", "/api/users/onboarding", null, admin); ok("onboarding list loads", ob.status === 200 && Array.isArray(ob.body?.people || ob.body));

  // Lockout
  let last; for (let i = 0; i < 8; i++) last = await call("POST", "/api/auth/login", { email: "lock@test.local", password: "x" });
  ok("repeated wrong logins are locked out (429)", last.status === 429);

  // Audit + backup
  const au = await call("GET", "/api/admin/audit", null, admin);
  ok("activity log records sign-ins and changes", au.status === 200 && au.body.some((r) => r.action === "LOGIN") && au.body.some((r) => r.action.startsWith("POST /api/users/me/pin")));
  const bk = await call("POST", "/api/admin/backups", null, admin); ok("backup can be created", bk.status === 201);
  const bl = await call("GET", "/api/admin/backups", null, admin); ok("backup is listed and not empty", bl.body?.[0]?.bytes > 10000);
  ok("unknown API route returns 404 JSON", (await call("GET", "/api/nope", null, admin)).status === 404);
} catch (e) {
  fail++; console.log("  FAIL  unexpected error:", e.message);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
