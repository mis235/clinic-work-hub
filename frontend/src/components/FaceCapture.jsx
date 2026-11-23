import { useEffect, useRef, useState } from "react";
import { faceDescriptor, startCamera, cameraHelp, loadFace, snapshotJpeg, frameBrightness, slowMode } from "../face.js";

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
    let crashes = 0, lastErr = null, dark = 0, bright = 0, noFace = 0, weak = 0;
    while (samples.length < need && tries < 80) {
      tries++;
      let r = null;
      try { r = await faceDescriptor(video.current); crashes = 0; } catch (e) { lastErr = e; if (++crashes === 3) { setMsg("Switching to the slower scanner…"); await slowMode(); } }
      const vw = video.current?.videoWidth || 640, br0 = r ? frameBrightness(video.current) : null;
      // Only a clear, well-lit, close face is saved. A weak sample makes two different people look alike.
      if (r && (r.score < 0.7 || r.box.width / vw < 0.2 || (br0 != null && (br0 < 70 || br0 > 205)))) {
        weak++;
        setMsg(br0 != null && br0 < 70 ? "Too dark. Turn towards a light or a window." : br0 != null && br0 > 205 ? "Too bright. Move away from the strong light." : r.box.width / vw < 0.2 ? "Come a little closer to the camera." : "Face not clear yet. Hold still and look straight at the camera.");
        await new Promise((x) => setTimeout(x, 250)); continue;
      }
      if (r) {
        samples.push(r.descriptor); setN(samples.length);
        if (!photo && samples.length === 2) photo = snapshotJpeg(video.current, 480); // a clean picture for the profile
        setMsg("Good — keep still, turn your head very slightly…"); await new Promise((x) => setTimeout(x, 500));
      } else {
        // Say what is really wrong, not always "light".
        const br = frameBrightness(video.current);
        if (lastErr && crashes > 0) setMsg("The face scanner is still starting. Please wait…");
        else if (br != null && br < 70) { dark++; setMsg("Too dark. Turn towards a light or a window."); }
        else if (br != null && br > 205) { bright++; setMsg("Too bright. Move away from the strong light behind or in front."); }
        else { noFace++; setMsg("The light is fine. Hold the phone at arm's length, face the camera straight, and keep the whole face inside the box. Take off cap, mask or sunglasses."); }
        await new Promise((x) => setTimeout(x, 250));
      }
    }
    if (samples.length < need) {
      setErr(weak > 0 && weak >= noFace ? "The face was seen but not clear enough to save. Come closer (the face should fill a good part of the box), look straight at the camera in good light, and press Start again."
        : lastErr && !noFace && !dark && !bright
        ? `The face scanner could not run on this phone (${lastErr.message || lastErr}). Try the Chrome browser on another phone or a computer.`
        : dark > noFace ? "Could not get enough clear samples: the picture is too dark. Try again in better light."
        : bright > noFace ? "Could not get enough clear samples: the picture is too bright. Try again away from strong light."
        : "Could not get enough clear samples. Hold still, face the camera straight and keep the whole face in the box, then press Start again.");
      setBusy(false); return;
    }
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
