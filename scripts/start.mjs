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
if (major < 20) {
  console.error(`\nNode.js ${process.versions.node} is too old. Install the LTS version from https://nodejs.org and try again.\n`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`\nStep failed: ${cmd} ${args.join(" ")}\n`); process.exit(r.status || 1); }
}

// 0. Permanent data home. Your clinic's data (database, photos, payslips, backups, passwords file) lives in ONE folder
// outside the app folder, so downloading a newer version from GitHub never starts you from a blank app again.
const dataHome = process.env.CLINIC_DATA || path.join(os.homedir(), "ClinicWorkHubData");
const KEEP_ITEMS = [".env", "clinic.db", "clinic.db-wal", "clinic.db-shm", "uploads", "payslips", "private", "backups"];
const hasData = (d) => fs.existsSync(path.join(d, ".env")) || fs.existsSync(path.join(d, "clinic.db"));
if (!hasData(dataHome)) {
  // First time with this feature: find the folder you have been using (this one, or an older downloaded copy beside it).
  const here = path.join(root, "backend");
  const parent = path.dirname(root);
  const candidates = [here];
  try {
    for (const e of fs.readdirSync(parent, { withFileTypes: true })) if (e.isDirectory()) candidates.push(path.join(parent, e.name, "backend"));
    const dl = path.join(os.homedir(), "Downloads");
    if (fs.existsSync(dl)) for (const e of fs.readdirSync(dl, { withFileTypes: true })) if (e.isDirectory()) { candidates.push(path.join(dl, e.name, "backend")); try { for (const e2 of fs.readdirSync(path.join(dl, e.name), { withFileTypes: true })) if (e2.isDirectory()) candidates.push(path.join(dl, e.name, e2.name, "backend")); } catch {} }
  } catch {}
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const best = [...new Set(candidates)].filter((d) => fs.existsSync(path.join(d, "clinic.db"))).sort((a, b) => (size(path.join(b, "clinic.db")) - size(path.join(a, "clinic.db"))) || (mtime(path.join(b, "clinic.db")) - mtime(path.join(a, "clinic.db"))))[0]; // the fullest database = the one you really used, not a fresh empty copy
  fs.mkdirSync(dataHome, { recursive: true });
  if (best) {
    say(`Moving your existing clinic data (from ${best}) into a permanent folder: ${dataHome}`);
    for (const it of KEEP_ITEMS) { const from = path.join(best, it); if (fs.existsSync(from)) fs.cpSync(from, path.join(dataHome, it), { recursive: true }); }
  }
}
fs.mkdirSync(dataHome, { recursive: true });

// 1. Settings file (never uploaded to GitHub). Created once with a private random login secret.
const envFile = path.join(dataHome, ".env");
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
const lan = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l || []).filter((i) => i.family === "IPv4" && !i.internal && !/vethernet|wsl|hyper-v|virtualbox|vmware|vmnet|docker|bluetooth/i.test(n)).map((i) => i.address)).sort((a, b) => (/^192\.168\./.test(b) ? 1 : 0) - (/^192\.168\./.test(a) ? 1 : 0));
const adminLine = freshPassword
  ? `  Admin sign-in:  admin@drnishitaranka.com  /  ${freshPassword}   (saved in ${envFile})`
  : `  Admin sign-in:  admin@drnishitaranka.com  /  the ADMIN_PASSWORD in ${envFile}`;
console.log(`
==============================================================
  Dr. Nishita's Clinic - Work Hub is starting
  On this computer:      http://localhost:${PORT}
  Phones on same Wi-Fi:  ${lan.length ? lan.map((a) => `https://${a}:4443`).join("   ") : "(no network found)"}   (accept the certificate warning once)
  Phone cannot open it?  Double-click open-phone-access-windows.bat once (Windows only), and keep phone on the clinic Wi-Fi.
${adminLine}
  Staff sign-in:  pick your name + PIN 1234 (you must then choose a new PIN)
  Your data is kept in: ${dataHome}   (safe when you download a newer version)
  Stop the app:   press Ctrl+C
==============================================================
`);

// 4. Run (from backend/ so it finds backend/.env)
const child = spawn(process.execPath, ["src/server.js"], { cwd: backend, stdio: "inherit", env: { ...process.env, PORT, DATA_DIR: dataHome, DOTENV_CONFIG_PATH: envFile } });
const tunnelFile = path.join(dataHome, "tunnel-url.txt");
try { fs.rmSync(tunnelFile, { force: true }); } catch {}
let tunnelChild = null;
child.on("exit", (code) => { try { tunnelChild?.kill(); fs.rmSync(tunnelFile, { force: true }); } catch {} process.exit(code ?? 0); });

// 5. Optional "link that works from anywhere" (free Cloudflare quick tunnel). Started by start-with-anywhere-link-windows.bat.
// The link changes each time. Anyone with it can reach the sign-in page, so everyone must use a private PIN.
async function startTunnel() {
  const exe = path.join(dataHome, "tools", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (!fs.existsSync(exe)) {
    const asset = process.platform === "win32" ? "cloudflared-windows-amd64.exe" : process.platform === "darwin" ? null : "cloudflared-linux-amd64";
    if (!asset) { console.log("\nThe anywhere link needs cloudflared. On Mac run:  brew install cloudflared  then start again with TUNNEL=1 npm start\n"); return; }
    say("Downloading the free secure-link tool (one time, ~30 MB)");
    try {
      const r = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`);
      if (!r.ok) throw new Error(`download failed (${r.status})`);
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, Buffer.from(await r.arrayBuffer())); fs.chmodSync(exe, 0o755);
    } catch (e) { console.log(`\nCould not download the secure-link tool: ${e.message}. Check the internet and start again.\n`); return; }
  }
  const launch = () => {
    tunnelChild = spawn(exe, ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
    let found = false;
    const onData = (b) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(b));
      if (m && !found) {
        found = true; fs.writeFileSync(tunnelFile, m[0]);
        console.log(`\n==============================================================\n  LINK THAT WORKS FROM ANYWHERE (phones, any Wi-Fi or mobile data):\n  ${m[0]}\n  It changes every time you start the app. Keep this window open.\n  Everyone must use a private PIN (not 1234).\n==============================================================\n`);
      }
    };
    tunnelChild.stdout.on("data", onData); tunnelChild.stderr.on("data", onData);
    tunnelChild.on("exit", () => { try { fs.rmSync(tunnelFile, { force: true }); } catch {} if (!child.killed && child.exitCode === null) setTimeout(launch, 5000); });
  };
  launch();
}
if (process.env.TUNNEL === "1") setTimeout(() => startTunnel().catch((e) => console.log("Anywhere link failed:", e.message)), 4000);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
