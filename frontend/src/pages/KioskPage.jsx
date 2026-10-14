import { useEffect, useRef, useState } from "react";
import { kioskApi } from "../api.js";
import { faceDescriptor, startCamera, cameraHelp, loadFace, snapshotJpeg } from "../face.js";

// Clinic-phone screen: staff look at the camera and are marked present. No login, no buttons for staff.
export default function KioskPage() {
  const video = useRef(null);
  const [state, setState] = useState({ phase: "start", text: "Starting…" });
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    // The setup link carries the phone's key once (#key=...). Save it and remove it from the address bar.
    const m = /key=([^&]+)/.exec(window.location.hash);
    if (m) { try { localStorage.setItem("kioskKey", decodeURIComponent(m[1])); } catch {} history.replaceState(null, "", "/kiosk"); }
    let dead = false, stop = null, last = { id: "", at: 0 };
    (async () => {
      try {
        if (!kioskApi.key()) throw new Error("NOKEY");
        const info = await kioskApi.call("ping");
        if (info.enrolled === 0) { setState({ phase: "error", text: "No faces are registered yet. Ask the admin to register staff faces first." }); return; }
        await loadFace(); stop = await startCamera(video.current);
        setState({ phase: "look", text: "Look at the camera" });
        while (!dead) {
          await new Promise((r) => setTimeout(r, 700));
          const f = await faceDescriptor(video.current).catch(() => null);
          if (!f) { setState((s) => (s.phase === "result" ? s : { phase: "look", text: "Look at the camera" })); continue; }
          if (Date.now() - last.at < 5000) continue; // keep showing the last result for a few seconds
          setState({ phase: "check", text: "Checking…" });
          const r = await kioskApi.call("checkin", { descriptor: f.descriptor, snapshot: snapshotJpeg(video.current) });
          last = { at: Date.now() };
          const hm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
          if (r.matched) {
            const out = r.kind === "out";
            setState({ phase: "result", ok: true,
              text: r.already ? `Already ${out ? "logged out" : "logged in"}, ${r.name}` : out ? `Goodbye, ${r.name}` : `Welcome, ${r.name}`,
              sub: r.already ? `${out ? "Out" : "In"} at ${r.time}` : out ? `Logged out ${r.time}${r.workedMinutes ? ` · worked ${hm(r.workedMinutes)}` : ""}` : `Logged in ${r.time} · ${r.label}` });
          } else setState({ phase: "result", ok: false, text: r.ambiguous ? "Please try again" : "Face not recognised", sub: r.ambiguous ? "Stand alone in front of the camera." : "Face the light and look straight at the camera. Ask the admin if it keeps happening." });
          setTimeout(() => setState((s) => (s.phase === "result" ? { phase: "look", text: "Look at the camera" } : s)), 4000);
        }
      } catch (e) {
        if (dead) return;
        setState({ phase: "error", text: e.message === "NOKEY" ? "This phone is not set up yet. Open the setup link from the admin." : e.status === 401 ? e.message : cameraHelp(e) });
      }
    })();
    return () => { dead = true; stop?.(); };
  }, []);

  const color = state.phase === "result" ? (state.ok ? "#0f9d6b" : "#d64545") : state.phase === "error" ? "#d64545" : "#fff";
  return (
    <div style={{ minHeight: "100vh", background: "#0b1b2b", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", padding: 20, gap: 14, fontFamily: "system-ui, sans-serif" }}>
      <img src="/logo.png" alt="" style={{ height: 44, marginTop: 6 }} />
      <div style={{ fontSize: 15, opacity: .8 }}>Dr. Nishita's Clinic · Attendance</div>
      <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em" }}>{clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
      <div style={{ opacity: .7, marginTop: -8 }}>{clock.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
      <div style={{ position: "relative", width: "min(92vw, 420px)", aspectRatio: "3/4", borderRadius: 28, overflow: "hidden", border: `4px solid ${color}`, background: "#000" }}>
        <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, textAlign: "center" }}>{state.text}</div>
      {state.sub && <div style={{ opacity: .85, textAlign: "center" }}>{state.sub}</div>}
    </div>
  );
}
