import { useEffect, useRef, useState } from "react";
import { scanFace, startCamera, cameraHelp, loadFace, snapshotJpeg, frameBrightness, slowMode, faceDist } from "../face.js";

const WHY = {
  none: "No face in view. Point the front camera at the face, about an arm's length away.",
  soft: "Face not clear yet. Hold still and look straight at the camera.",
  far: "Come a little closer to the camera.",
  off: "Move the face to the middle of the box.",
  shape: "Look straight at the camera and keep the head upright.",
};

// Camera box that collects a few face samples plus one profile picture. Used when registering a face and when adding staff.
// Only a real, centred, clear face is saved. Before pressing Start the box shows live whether a face is seen.
export default function FaceCapture({ who, need = 5, onCaptured, disabled }) {
  const video = useRef(null);
  const stopRef = useRef(null);
  const [msg, setMsg] = useState("Starting the camera…");
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(null); // { ok, text } while waiting for Start
  const busyRef = useRef(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try { await loadFace(); stopRef.current = await startCamera(video.current); if (!dead) { setReady(true); setMsg(`Ask ${who || "the person"} to look at the camera, then press Start.`); } }
      catch (e) { if (!dead) setErr(cameraHelp(e)); }
    })();
    return () => { dead = true; stopRef.current?.(); };
  }, []);

  // Live check before Start, so the admin sees at once whether the camera really has a face.
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    (async () => {
      while (!dead) {
        await new Promise((x) => setTimeout(x, 800));
        if (busyRef.current || dead) continue;
        try { const r = await scanFace(video.current, "enroll"); if (!dead && !busyRef.current) setLive(r.ok ? { ok: true, text: "Face found. Press Start." } : { ok: false, text: reasonText(r.why) }); } catch {}
      }
    })();
    return () => { dead = true; };
  }, [ready]);

  function reasonText(why) {
    const br = frameBrightness(video.current);
    if (why === "none" && br != null && br < 70) return "Too dark. Turn towards a light or a window.";
    if (why === "none" && br != null && br > 205) return "Too bright. Move away from the strong light.";
    return WHY[why] || WHY.none;
  }

  async function start() {
    busyRef.current = true; setBusy(true); setErr(""); setN(0); setLive(null);
    const samples = []; let tries = 0, photo = null, crashes = 0, lastErr = null, rejected = 0;
    while (samples.length < need && tries < 90) {
      tries++;
      let r = null;
      try { r = await scanFace(video.current, "enroll"); crashes = 0; } catch (e) { lastErr = e; if (++crashes === 3) { setMsg("Switching to the slower scanner…"); await slowMode(); } }
      if (r?.ok) {
        // Every new sample must be the same face as the ones already taken.
        if (samples.length && samples.some((d) => faceDist(d, r.descriptor) > 0.6)) { rejected++; setMsg("Only one person in front of the camera, please."); await new Promise((x) => setTimeout(x, 300)); continue; }
        samples.push(r.descriptor); setN(samples.length);
        if (!photo && samples.length === 2) photo = snapshotJpeg(video.current, 480); // a clean picture for the profile
        setMsg("Good. Keep still and turn your head very slightly…"); await new Promise((x) => setTimeout(x, 500));
      } else {
        setMsg(lastErr && crashes > 0 ? "The face scanner is still starting. Please wait…" : reasonText(r?.why || "none"));
        await new Promise((x) => setTimeout(x, 250));
      }
    }
    if (samples.length < need) {
      setErr(lastErr && !samples.length && !rejected ? `The face scanner could not run on this phone (${lastErr.message || lastErr}). Try Chrome on another phone or a computer.`
        : rejected > 3 ? "More than one face was seen. Only the person being registered should be in front of the camera. Press Start again."
        : "A clear face was not found for long enough. Point the front camera at the face in good light, fill about a third of the box, look straight, and press Start again.");
      busyRef.current = false; setBusy(false); return;
    }
    const blob = photo ? await (await fetch(photo)).blob() : null;
    busyRef.current = false; setBusy(false);
    try { await onCaptured({ descriptors: samples, photo: blob }); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 16, background: "#000", transform: "scaleX(-1)", border: `3px solid ${live?.ok ? "#4cc38a" : "transparent"}` }} />
      <div className="meta" style={{ marginTop: 8, color: live && !busy ? (live.ok ? "#176b34" : "#8a5a00") : undefined, fontWeight: live && !busy ? 700 : undefined }}>{busy ? msg : live ? live.text : msg} {n > 0 && `(${n}/${need})`}</div>
      {err && <div className="login-error" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !ready || disabled} onClick={start}>{busy ? "Scanning…" : "Start"}</button>
    </div>
  );
}
