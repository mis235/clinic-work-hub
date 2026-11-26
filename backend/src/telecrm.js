// Sends a staff message through TeleCRM's inbound webhook (a TeleCRM workflow then sends the approved WhatsApp template).
// Off until the link is saved:  bash deploy/set-setting.sh telecrm "<TeleCRM webhook link>"
import db from "./db.js";
export const telecrmUrl = () => db.prepare("SELECT value FROM app_settings WHERE key = 'telecrm_webhook'").get()?.value || "";
const digits = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; return d.length >= 11 ? d : ""; };

/** Fire-and-forget. Never throws. Returns true if a request was started. */
export function sendViaTelecrm({ name, phone, message, event = "announcement" }) {
  try {
    const url = telecrmUrl(), to = digits(phone); if (!url || !to || !message) return false;
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ name: name || "Staff", phone: to, message: String(message).replace(/\s*\n+\s*/g, " ").slice(0, 900), event }) })
      .catch((e) => console.error("telecrm:", e.message));
    return true;
  } catch { return false; }
}

/** Admin test: sends one message to one number and reports what TeleCRM answered. */
export async function testTelecrm(phone) {
  const url = telecrmUrl(), to = digits(phone);
  if (!url) return { ok: false, error: "Paste the TeleCRM link first." };
  if (!to) return { ok: false, error: "Type a 10-digit mobile number." };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ name: "Test", phone: to, message: "This is a test message from Clinic Work Hub.", event: "test" }) });
    const body = (await r.text().catch(() => "")).slice(0, 200);
    return r.ok ? { ok: true, status: r.status, sentTo: to } : { ok: false, status: r.status, error: `TeleCRM answered ${r.status}. Check the link and that the workflow is turned on.`, body };
  } catch (e) { return { ok: false, error: "Could not reach TeleCRM: " + e.message }; }
}
