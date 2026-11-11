import { useEffect, useRef, useState } from "react";
import Lumi from "../components/Lumi.jsx";
import { kioskApi } from "../api.js";
import { faceDescriptor, startCamera, cameraHelp, loadFace, snapshotJpeg } from "../face.js";

// Clinic-phone screen: staff look at the camera and are marked present. No login, no buttons for staff.
export default function KioskPage() {
  const video = useRef(null);
  const [state, setState] = useState({ phase: "start", text: "Starting…" });
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  // Make this page installable as its own "Check-in" app (separate from the Work Hub app).
  const [installEvt, setInstallEvt] = useState(null);
  const [showHow, setShowHow] = useState(false);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone);
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const old = link?.getAttribute("href");
    link?.setAttribute("href", "/kiosk.webmanifest");
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); if (old) link?.setAttribute("href", old); };
  }, []);
  const install = async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); setInstallEvt(null); }
    else setShowHow((v) => !v);
  };

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
              sub: r.already ? `${out ? "Out" : "In"} at ${r.time}` : out ? `Logged out ${r.time}${r.workedMinutes ? ` · worked ${hm(r.workedMinutes)}` : ""}${r.message ? ` · ${r.message}` : ""}` : `Logged in ${r.time} · ${r.label}` });
          } else setState({ phase: "result", ok: false, text: r.ambiguous ? "Please try again" : "Face not recognised", sub: r.ambiguous ? "Stand alone in front of the camera." : "Face the light and look straight at the camera. Ask the admin if it keeps happening." });
          setTimeout(() => setState((s) => (s.phase === "result" ? { phase: "look", text: "Look at the camera" } : s)), 4000);
        }
      } catch (e) {
        if (dead) return;
        setState({ phase: "error", text: e.message === "NOKEY" ? "This phone is not set up yet. Open the setup link from the admin." : e.status === 401 || e.status === 403 ? e.message : cameraHelp(e) });
      }
    })();
    return () => { dead = true; stop?.(); };
  }, []);

  const mood = state.phase === "result" ? (state.ok ? "cheer" : "sorry") : state.phase === "error" ? "sorry" : state.phase === "check" ? "think" : "wave";
  const color = state.phase === "result" ? (state.ok ? "#12a56f" : "#d64545") : state.phase === "error" ? "#d64545" : "#fff";
  return (
    <div style={{ minHeight: "100vh", background: "#2a1b3d", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", padding: 20, gap: 14, fontFamily: "system-ui, sans-serif" }}>
      <img src="/logo.png" alt="" style={{ height: 44, marginTop: 6 }} />
      <div style={{ fontSize: 15, opacity: .8 }}>Dr. Nishita's Clinic · Attendance</div>
      <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em" }}>{clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
      <div style={{ opacity: .7, marginTop: -8 }}>{clock.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
      {state.phase === "result" && state.ok && <div className="lumi-confetti" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ["#0B6B63", "#E2B84F", "#7FE0D2", "#F29AA6"][i % 4], animationDelay: `${(i % 7) * 0.12}s` }} />)}</div>}
      <Lumi mood={mood} size={96} />
      <div style={{ position: "relative", width: "min(92vw, 420px)", aspectRatio: "3/4", borderRadius: 28, overflow: "hidden", border: `4px solid ${color}`, background: "#000" }}>
        <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, textAlign: "center" }}>{state.text}</div>
      {state.sub && <div style={{ opacity: .85, textAlign: "center" }}>{state.sub}</div>}
      {!standalone && (
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <button onClick={install} style={{ background: "#C42F8F", color: "#fff", border: 0, borderRadius: 999, padding: "12px 22px", fontSize: 16, fontWeight: 700 }}>Install Check-in app</button>
          {showHow && <div style={{ marginTop: 10, opacity: .9, maxWidth: 320, fontSize: 14 }}>Tap the 3 dots (⋮) at the top right of Chrome, then tap “Add to Home screen” and “Install”. On iPhone: tap Share, then “Add to Home Screen”.</div>}
        </div>
      )}
    </div>
  );
}
