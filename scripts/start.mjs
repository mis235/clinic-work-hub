// One-command launcher:  npm start
// First run: creates settings, installs, builds. Every run: starts the whole clinic app on port 4000.
import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const frontend = path.join(root, "frontend");
const PORT = process.env.PORT || "4000";
const say = (m) => console.log(`\n▶ ${m}`);

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(`\nNode.js ${process.versions.node} is too old. Install the LTS version from https://nodejs.org and try again.\n`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`\nStep failed: ${cmd} ${args.join(" ")}\n`); process.exit(r.status || 1); }
}

// 1. Settings file (never uploaded to GitHub). Created once with a private random login secret.
const envFile = path.join(backend, ".env");
let freshPassword = null;
if (!fs.existsSync(envFile)) {
  say("First run: creating your settings");
  freshPassword = randomBytes(6).toString("base64url");
  fs.writeFileSync(envFile, [
    `PORT=${PORT}`,
    `JWT_SECRET=${randomBytes(32).toString("hex")}`,
    `ADMIN_EMAIL=admin@drnishitaranka.com`,
    `ADMIN_PASSWORD=${freshPassword}`,
    `WEBAUTHN_RP_ID=localhost`,
    `WEBAUTHN_RP_NAME=Dr. Nishita's Clinic`,
    `WEBAUTHN_ORIGIN=http://localhost:${PORT}`,
    "",
  ].join("\n"));
}

// 1b. An older or hand-made settings file may lack the login secret: add whatever is missing (never overwrites).
if (fs.existsSync(envFile) && freshPassword === null) {
  let txt = fs.readFileSync(envFile, "utf8");
  const has = (k) => new RegExp(`^${k}=.+`, "m").test(txt);
  const add = [];
  if (!has("JWT_SECRET")) add.push(`JWT_SECRET=${randomBytes(32).toString("hex")}`);
  if (!has("ADMIN_EMAIL")) add.push("ADMIN_EMAIL=admin@drnishitaranka.com");
  if (!has("ADMIN_PASSWORD")) { freshPassword = randomBytes(6).toString("base64url"); add.push(`ADMIN_PASSWORD=${freshPassword}`); }
  if (add.length) { say("Adding missing settings to backend/.env"); fs.writeFileSync(envFile, txt.replace(/\s*$/, "\n") + add.join("\n") + "\n"); }
}

// 2. Install + build (only when needed; re-does it automatically after an update)
import crypto from "node:crypto";
const sig = (files) => crypto.createHash("md5").update(files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : "")).join("|")).digest("hex");
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const stampFile = path.join(root, ".build-stamp.json");
let stamp = {}; try { stamp = JSON.parse(fs.readFileSync(stampFile, "utf8")); } catch {}
const depSig = sig([path.join(backend, "package.json"), path.join(frontend, "package.json")]);
const srcSig = sig([...walk(path.join(frontend, "src")), ...walk(path.join(frontend, "public")).filter((f) => !f.includes("models")), path.join(frontend, "index.html")]);
const depsChanged = stamp.dep !== depSig;
if (depsChanged || !fs.existsSync(path.join(backend, "node_modules"))) { say("Installing server parts (~1 minute)"); run("npm", ["install", "--no-audit", "--no-fund"], backend); }
if (depsChanged || !fs.existsSync(path.join(frontend, "node_modules"))) { say("Installing screen parts (~1 minute)"); run("npm", ["install", "--no-audit", "--no-fund"], frontend); }
if (depsChanged || stamp.src !== srcSig || !fs.existsSync(path.join(frontend, "dist", "index.html")) || process.env.REBUILD) { say("Building the app screens"); run("npm", ["run", "build"], frontend); }
fs.writeFileSync(stampFile, JSON.stringify({ dep: depSig, src: srcSig }));

// 3. Tell people where to open it
const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
const adminLine = freshPassword
  ? `  Admin sign-in:  admin@drnishitaranka.com  /  ${freshPassword}   (saved in backend/.env)`
  : `  Admin sign-in:  admin@drnishitaranka.com  /  the ADMIN_PASSWORD in backend/.env`;
console.log(`
==============================================================
  Dr. Nishita's Clinic - Work Hub is starting
  On this computer:      http://localhost:${PORT}
  Phones on same Wi-Fi:  ${lan.length ? lan.map((a) => `https://${a}:4443`).join("   ") : "(no network found)"}   (accept the certificate warning once)
${adminLine}
  Staff sign-in:  pick your name + PIN 1234 (you must then choose a new PIN)
  Stop the app:   press Ctrl+C
==============================================================
`);

// 4. Run (from backend/ so it finds backend/.env)
const child = spawn(process.execPath, ["src/server.js"], { cwd: backend, stdio: "inherit", env: { ...process.env, PORT } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
