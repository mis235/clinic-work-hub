// Second, secure (https) door to the same app on the clinic Wi-Fi. Phones only allow the camera on https, so the
// clinic-phone face check-in opens through this one. The certificate is made by this computer (self-signed): the first
// time, the phone shows "connection not private" -> Advanced -> Proceed. After that the camera works.
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
export const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
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
