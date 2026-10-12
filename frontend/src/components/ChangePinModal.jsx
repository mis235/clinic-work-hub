import { useState } from "react";
import { api } from "../api.js";
import Icon from "./Icon.jsx";

// Shown on first sign-in (or after an admin reset) — the shared starter PIN must be replaced.
export default function ChangePinModal({ forced, onDone, onClose }) {
  const [cur, setCur] = useState(forced ? "" : "");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const digits = (setter) => (e) => setter(e.target.value.replace(/\D/g, "").slice(0, 4));

  async function save() {
    setErr("");
    if (pin !== again) return setErr("The new PINs do not match.");
    setBusy(true);
    try { await api.changeMyPin(cur, pin); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={forced ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="kpi-ico teal" style={{ marginBottom: 12 }}><Icon name="key" size={20} /></div>
        <h3>{forced ? "Set your own PIN" : "Change your PIN"}</h3>
        <p className="lead">{forced ? "For security, please replace the temporary PIN you were given with a PIN only you know." : "Choose a new 4-digit PIN."}</p>
        <label className="field-label">Current PIN</label>
        <input className="field" type="password" inputMode="numeric" value={cur} onChange={digits(setCur)} />
        <label className="field-label">New PIN (4 digits, not 1234)</label>
        <input className="field" type="password" inputMode="numeric" value={pin} onChange={digits(setPin)} />
        <label className="field-label">Confirm new PIN</label>
        <input className="field" type="password" inputMode="numeric" value={again} onChange={digits(setAgain)} />
        {err && <div className="login-error">{err}</div>}
        <div className="actions">
          {!forced && <button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
          <button className="btn btn-primary" disabled={busy || cur.length !== 4 || pin.length !== 4 || again.length !== 4} onClick={save}>{busy ? "Saving…" : "Save PIN"}</button>
        </div>
      </div>
    </div>
  );
}
