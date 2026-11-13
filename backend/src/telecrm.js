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
