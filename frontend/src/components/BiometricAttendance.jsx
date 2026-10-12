import { useEffect, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { api } from "../api.js";

function detectDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Mac/.test(ua)) return "Mac";
  if (/Win/.test(ua)) return "Windows PC";
  return "This device";
}

export default function BiometricAttendance() {
  const [devices, setDevices] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState(null);

  const refreshDevices = () => api.registeredDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => { refreshDevices(); }, []);

  async function registerDevice() {
    setError(""); setBusy(true);
    try {
      const options = await api.registrationOptions();
      // This line is what actually triggers the phone's Face ID / fingerprint prompt.
      const attResp = await startRegistration({ optionsJSON: options });
      await api.registrationVerify({ ...attResp, deviceLabel: detectDeviceLabel() });
      await refreshDevices();
    } catch (e) {
      setError(humanizeWebAuthnError(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkInOrOut() {
    setError(""); setBusy(true);
    try {
      const options = await api.checkinOptions();
      const authResp = await startAuthentication({ optionsJSON: options });

      let coords = {};
      try {
        const pos = await getPosition();
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch {
        // Location is optional — attendance still records without it.
      }

      const result = await api.checkinVerify({ credential: authResp, ...coords });
      setLastAction(result);
    } catch (e) {
      setError(humanizeWebAuthnError(e));
    } finally {
      setBusy(false);
    }
  }

  if (devices === null) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div><span className="name">Attendance</span><span className="dept">via this phone's biometric sensor</span></div>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}

      {devices.length === 0 ? (
        <>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "4px 0 12px" }}>
            No device registered yet. Register this phone once — it uses your fingerprint or Face ID, the clinic never sees or stores the biometric itself.
          </p>
          <button className="btn btn-primary" style={{ width: "auto" }} disabled={busy} onClick={registerDevice}>
            {busy ? "Waiting for biometric…" : "Register this device"}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "4px 0 12px" }}>
            Registered: {devices.map((d) => d.device_label).join(", ")}
          </p>
          <button className="btn-wa" style={{ padding: "10px 18px", fontSize: 13.5 }} disabled={busy} onClick={checkInOrOut}>
            {busy ? "Waiting for biometric…" : "Check in / out"}
          </button>
          {lastAction && (
            <div className="note" style={{ marginTop: 12, marginBottom: 0 }}>
              Recorded <strong>{lastAction.type === "check_in" ? "check-in" : "check-out"}</strong> at{" "}
              {new Date(lastAction.recordedAt).toLocaleTimeString()}.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
  });
}

function humanizeWebAuthnError(e) {
  const msg = e?.message || String(e);
  if (msg.includes("NotAllowedError") || e?.name === "NotAllowedError") {
    return "Cancelled or timed out — try again and approve the biometric prompt.";
  }
  if (msg.toLowerCase().includes("platform")) {
    return "This device doesn't support fingerprint/Face ID sign-in.";
  }
  return msg;
}
