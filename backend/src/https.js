// Second, secure (https) door to the same app on the clinic Wi-Fi. Phones only allow the camera on https, so the
// clinic-phone face check-in opens through this one. The certificate is made by this computer (self-signed): the first
// time, the phone shows "connection not private" -> Advanced -> Proceed. After that the camera works.
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
// Real Wi-Fi/LAN addresses first. Windows also has "virtual" adapters (WSL, Hyper-V, VirtualBox, VMware, Docker) whose
// addresses (often 172.x) phones can never reach, so they are skipped / put last.
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|vmnet|docker|loopback|tailscale|zerotier|bluetooth/i;
const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 3 : 2);
export const lanAddresses = () => {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ ip: i.address, virtual: VIRTUAL.test(name) })));
  const real = all.filter((a) => !a.virtual), use = real.length ? real : all;
  return [...new Set(use.sort((a, b) => rank(a.ip) - rank(b.ip)).map((a) => a.ip))];
};
export let httpsRunning = false;

export async function startHttps(app) {
  if (process.env.NODE_ENV === "test" || process.env.NO_HTTPS) return;
  try {
    const dir = path.join(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), "private", "certs");
    fs.mkdirSync(dir, { recursive: true });
    const ips = lanAddresses(), sig = ips.join(",");
    const keyF = path.join(dir, "key.pem"), certF = path.join(dir, "cert.pem"), sigF = path.join(dir, "sig.txt");
    if (!fs.existsSync(keyF) || !fs.existsSync(certF) || (fs.existsSync(sigF) ? fs.readFileSync(sigF, "utf8") : "") !== sig) {
      const { generate } = await import("selfsigned");
      const pems = await generate([{ name: "commonName", value: "Clinic Work Hub" }], {
        days: 3650, keySize: 2048, algorithm: "sha256",
        extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }, ...ips.map((ip) => ({ type: 7, ip }))] }],
      });
      fs.writeFileSync(keyF, pems.private); fs.writeFileSync(certF, pems.cert); fs.writeFileSync(sigF, sig);
    }
    const srv = https.createServer({ key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) }, app);
    srv.on("error", (e) => console.log(`Secure (https) door not started: ${e.code || e.message}`));
    srv.listen(HTTPS_PORT, () => { httpsRunning = true; console.log(`Secure door for phone cameras: https://localhost:${HTTPS_PORT}`); });
  } catch (e) { console.log("Secure (https) door not started:", e.message); }
}
