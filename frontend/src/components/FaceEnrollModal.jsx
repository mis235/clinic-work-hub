import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { faceDescriptor, startCamera, cameraHelp, loadFace } from "../face.js";

// Admin registers a person's face once (takes a few samples with the camera). Needs the person standing in front of the camera.
export default function FaceEnrollModal({ person, onClose, onDone }) {
  const video = useRef(null);
  const [msg, setMsg] = useState("Starting the camera…");
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(null);
  const samples = useRef([]);
  const NEED = 5;

  useEffect(() => {
    let dead = false;
    (async () => {
      try { await loadFace(); stopRef.current = await startCamera(video.current); if (!dead) setMsg(`Ask ${person.name} to look at the camera, then press Start.`); }
      catch (e) { if (!dead) setErr(cameraHelp(e)); }
    })();
    return () => { dead = true; stopRef.current?.(); };
  }, []);

  async function start() {
    setBusy(true); setErr(""); samples.current = []; setN(0);
    let tries = 0;
    while (samples.current.length < NEED && tries < 40) {
      tries++;
      const r = await faceDescriptor(video.current).catch(() => null);
      if (r) { samples.current.push(r.descriptor); setN(samples.current.length); setMsg("Good — keep still and turn your head very slightly…"); await new Promise((x) => setTimeout(x, 500)); }
      else { setMsg("No clear face found — move closer, face the light."); await new Promise((x) => setTimeout(x, 300)); }
    }
    if (samples.current.length < NEED) { setErr("Could not get enough clear samples. Try again with better light."); setBusy(false); return; }
    try { await api.enrollFace(person.id, samples.current); onDone(`${person.name}'s face is registered.`); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  async function remove() { try { await api.removeFace(person.id); onDone(`${person.name}'s face was removed.`); } catch (e) { setErr(e.message); } }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Register face — {person.name}</h3>
        <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 16, background: "#000", marginTop: 12, transform: "scaleX(-1)" }} />
        <div className="meta" style={{ marginTop: 8 }}>{msg} {n > 0 && `(${n}/${NEED})`}</div>
        {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="actions">
          <button className="btn btn-ghost" onClick={remove}>Remove saved face</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={busy || !!err && !video.current?.srcObject} onClick={start}>{busy ? "Scanning…" : "Start"}</button>
        </div>
      </div>
    </div>
  );
}
