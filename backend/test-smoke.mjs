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

  // ---- Remodel features ----
  const form = async (method, url, fd, token) => {
    const r = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const raw = async (url, token, opts = {}) => fetch(base + url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });

  // Attendance: one tap = check in; board shows it
  const p1 = await call("POST", "/api/attendance/punch", {}, stoken2());
  function stoken2() { return stoken; }
  ok("one-tap attendance records a check-in", p1.status === 201 && p1.body?.type === "check_in", JSON.stringify(p1.body));
  const p2 = await call("POST", "/api/attendance/punch", {}, stoken);
  ok("accidental double tap is ignored", p2.body?.duplicate === true);
  const bd = await call("GET", "/api/attendance/board", null, admin);
  ok("admin attendance board shows who is in", bd.status === 200 && bd.body.rows.some((r) => r.id === staff.id && r.status === "in"));
  ok("staff cannot open the admin board", (await call("GET", "/api/attendance/board", null, stoken)).status === 403);

  // Documents hub: staff uploads, admin sees it
  let fd = new FormData(); fd.append("title", "MIS daily sheet"); fd.append("category", "Sheet"); fd.append("file", new Blob(["a,b\n1,2"], { type: "text/csv" }), "daily.csv");
  const up = await form("POST", "/api/documents", fd, stoken);
  ok("staff can upload a document", up.status === 201, JSON.stringify(up.body));
  fd = new FormData(); fd.append("title", "Sales dashboard"); fd.append("category", "Dashboard"); fd.append("url", "https://example.com/dash");
  ok("staff can add a dashboard link", (await form("POST", "/api/documents", fd, stoken)).status === 201);
  const dl = await call("GET", "/api/documents", null, admin);
  ok("admin sees every department's documents", dl.body?.documents?.length >= 2 && dl.body.canSeeAll);
  const file = await raw(`/api/documents/${up.body.id}/file`, admin);
  ok("admin can download the uploaded file", file.status === 200 && (await file.text()).includes("1,2"));
  ok("document files are not publicly reachable", (await fetch(base + `/api/documents/${up.body.id}/file`)).status === 401);

  // Templates -> bulk generate
  const sample = await raw("/api/doc-templates/sample/offer_letter", admin);
  const sbuf = Buffer.from(await sample.arrayBuffer());
  ok("sample offer-letter template downloads as a Word file", sample.status === 200 && sbuf.slice(0, 2).toString() === "PK");
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "Standard offer"); fd.append("file", new Blob([sbuf]), "offer.docx");
  const tu = await form("POST", "/api/doc-templates", fd, admin);
  ok("admin can upload an offer-letter template", tu.status === 201, JSON.stringify(tu.body));
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "x"); fd.append("file", new Blob([sbuf]), "offer.docx");
  ok("staff cannot upload templates", (await form("POST", "/api/doc-templates", fd, stoken)).status === 403);
  const gen = await call("POST", "/api/doc-templates/generate", { templateId: tu.body.id }, admin);
  ok("offer letters generated for all staff", gen.status === 201 && gen.body.generated.length >= 5, JSON.stringify(gen.body).slice(0, 200));
  const zip = await raw("/api/doc-templates/generated/zip", admin, { method: "POST", body: JSON.stringify({ ids: gen.body.generated.slice(0, 3).map((g) => g.id) }) });
  ok("generated letters download as one ZIP", zip.status === 200 && (await zip.arrayBuffer()).byteLength > 500);

  // Payroll template per company
  const comps = (await call("GET", "/api/companies", null, admin)).body;
  await call("POST", "/api/payroll/profile", { userId: staff.id, companyId: comps[0].id, employeeCode: "T1", position: "Tester", basicSalary: 20000, pf: 1000 }, admin);
  const ps = Buffer.from(await (await raw("/api/doc-templates/sample/payslip", admin)).arrayBuffer());
  fd = new FormData(); fd.append("kind", "payslip"); fd.append("name", "Payslip"); fd.append("companyId", comps[0].id); fd.append("file", new Blob([ps]), "pay.docx");
  const pt = await form("POST", "/api/doc-templates", fd, admin);
  const pg = await call("POST", "/api/doc-templates/generate", { templateId: pt.body.id, period: "2026-10" }, admin);
  ok("company payslip template generates for that company's staff", pg.status === 201 && pg.body.generated.length === 1, JSON.stringify(pg.body));
  fd = new FormData(); fd.append("kind", "offer_letter"); fd.append("name", "bad"); fd.append("file", new Blob(["not a word file"]), "bad.docx");
  ok("a broken Word file is rejected with a clear message", (await form("POST", "/api/doc-templates", fd, admin)).status === 400);

  // Staff add / edit / remove
  const added = await call("POST", "/api/users", { name: "Test Person", departmentName: "Front Desk", roleName: "staff", phone: "+919111111111", pin: "4321" }, admin);
  ok("admin can add a staff member", added.status === 201, JSON.stringify(added.body));
  const nt = (await call("POST", "/api/auth/login", { userId: added.body.id, pin: "4321" })).body?.token;
  ok("new staff member can sign in", !!nt);
  const ed = await call("PATCH", `/api/users/${added.body.id}`, { name: "Test Renamed", departmentName: "Pharmacy" }, admin);
  ok("admin can edit name and department", ed.status === 200);
  ok("edit shows in the directory", (await call("GET", "/api/users/full", null, admin)).body.some((u) => u.name === "Test Renamed" && u.department === "Pharmacy"));
  await call("PATCH", `/api/users/${added.body.id}/deactivate`, null, admin);
  ok("removed staff lose access immediately", (await call("GET", "/api/tasks", null, nt)).status === 401);
  ok("removed staff are hidden from the active list", !(await call("GET", "/api/users/full", null, admin)).body.some((u) => u.id === added.body.id));
  ok("removed staff can be restored", (await call("PATCH", `/api/users/${added.body.id}/reactivate`, null, admin)).status === 200);

  // Training videos: link + upload + edit + delete
  const tv = await call("POST", "/api/hr/training-videos", { department: "Front Desk", title: "Welcome", url: "https://youtu.be/dQw4w9WgXcQ" }, admin);
  ok("admin can add a training link", tv.status === 201, JSON.stringify(tv.body));
  fd = new FormData(); fd.append("department", "All Staff"); fd.append("title", "Hygiene"); fd.append("file", new Blob([Buffer.alloc(2048)], { type: "video/mp4" }), "h.mp4");
  const vu = await form("POST", "/api/hr/training-videos", fd, admin);
  ok("admin can upload a training video file", vu.status === 201, JSON.stringify(vu.body));
  ok("uploaded video streams to a signed-in viewer", (await fetch(base + `/api/hr/training-videos/${vu.body.id}/stream?token=${stoken}`)).status === 200);
  ok("training video can be edited", (await call("PATCH", `/api/hr/training-videos/${tv.body.id}`, { title: "Welcome v2" }, admin)).status === 200);
  ok("training video can be deleted", (await call("DELETE", `/api/hr/training-videos/${vu.body.id}`, null, admin)).status === 200);

  // History import
  const csv = 'Submitted At,Clinic,Staff Name,Role,Date,Shift,Completed,Total,Completion %,Checklist Detail,Metrics\n' +
    `17/09/2026 23:51:08,Clinic,${staff.name.split(" ")[0]},Some Role,2026-09-18,Morning,1,2,50,"Opening:\n  [DONE] Did a thing.\n  [PENDING] Other thing.",Patients: 3; Foo: -\n` +
    '17/09/2026 23:55:08,Clinic,Nobody Known,Some Role,2026-09-18,Morning,1,1,100,"Opening:\n  [DONE] X.",\n';
  fd = new FormData(); fd.append("file", new Blob([csv], { type: "text/csv" }), "log.csv"); fd.append("dryRun", "false");
  const im = await form("POST", "/api/shift-checklist/import", fd, admin);
  ok("checklist history imports and reports unknown names", im.status === 200 && im.body.imported === 1 && im.body.unmatched[0]?.name === "Nobody Known", JSON.stringify(im.body).slice(0, 200));
  const rp = await call("GET", "/api/reports/summary?days=365", null, admin);
  ok("reports include imported checklists in completion", rp.body?.completion?.total >= 2, JSON.stringify(rp.body?.completion));
  ok("staff cannot import history", (await form("POST", "/api/shift-checklist/import", fd, stoken)).status === 403);

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
