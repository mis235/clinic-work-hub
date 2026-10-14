import { useEffect, useRef, useState } from "react";
import { faceDescriptor, startCamera, cameraHelp, loadFace, snapshotJpeg } from "../face.js";

// Camera box that collects a few face samples plus one profile picture. Used when registering a face and when adding staff.
export default function FaceCapture({ who, need = 5, onCaptured, disabled }) {
  const video = useRef(null);
  const stopRef = useRef(null);
  const [msg, setMsg] = useState("Starting the camera…");
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try { await loadFace(); stopRef.current = await startCamera(video.current); if (!dead) { setReady(true); setMsg(`Ask ${who || "the person"} to look at the camera, then press Start.`); } }
      catch (e) { if (!dead) setErr(cameraHelp(e)); }
    })();
    return () => { dead = true; stopRef.current?.(); };
  }, []);

  async function start() {
    setBusy(true); setErr(""); setN(0);
    const samples = []; let tries = 0, photo = null;
    while (samples.length < need && tries < 60) {
      tries++;
      const r = await faceDescriptor(video.current).catch(() => null);
      if (r) {
        samples.push(r.descriptor); setN(samples.length);
        if (!photo && samples.length === 2) photo = snapshotJpeg(video.current, 480); // a clean picture for the profile
        setMsg("Good — keep still, turn your head very slightly…"); await new Promise((x) => setTimeout(x, 500));
      } else { setMsg("No clear face found — move closer and face the light."); await new Promise((x) => setTimeout(x, 300)); }
    }
    if (samples.length < need) { setErr("Could not get enough clear samples. Try again with better light."); setBusy(false); return; }
    const blob = photo ? await (await fetch(photo)).blob() : null;
    setBusy(false);
    try { await onCaptured({ descriptors: samples, photo: blob }); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 16, background: "#000", transform: "scaleX(-1)" }} />
      <div className="meta" style={{ marginTop: 8 }}>{msg} {n > 0 && `(${n}/${need})`}</div>
      {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !ready || disabled} onClick={start}>{busy ? "Scanning…" : "Start"}</button>
    </div>
  );
}
