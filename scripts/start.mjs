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

// 2. Install + build (only when needed)
if (!fs.existsSync(path.join(backend, "node_modules"))) { say("Installing server (one time, ~1 minute)"); run("npm", ["install", "--no-audit", "--no-fund"], backend); }
if (!fs.existsSync(path.join(frontend, "node_modules"))) { say("Installing screens (one time, ~1 minute)"); run("npm", ["install", "--no-audit", "--no-fund"], frontend); }
if (!fs.existsSync(path.join(frontend, "dist", "index.html")) || process.env.REBUILD) { say("Building the app screens"); run("npm", ["run", "build"], frontend); }

// 3. Tell people where to open it
const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
const adminLine = freshPassword
  ? `  Admin sign-in:  admin@drnishitaranka.com  /  ${freshPassword}   (saved in backend/.env)`
  : `  Admin sign-in:  admin@drnishitaranka.com  /  the ADMIN_PASSWORD in backend/.env`;
console.log(`
==============================================================
  Dr. Nishita's Clinic - Work Hub is starting
  On this computer:      http://localhost:${PORT}
  Phones on same Wi-Fi:  ${lan.length ? lan.map((a) => `http://${a}:${PORT}`).join("   ") : "(no network found)"}
${adminLine}
  Staff sign-in:  pick your name + PIN 1234 (you must then choose a new PIN)
  Stop the app:   press Ctrl+C
==============================================================
`);

// 4. Run (from backend/ so it finds backend/.env)
const child = spawn(process.execPath, ["src/server.js"], { cwd: backend, stdio: "inherit", env: { ...process.env, PORT } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
