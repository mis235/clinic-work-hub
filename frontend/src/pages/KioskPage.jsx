import { useEffect, useRef, useState } from "react";
import Doll from "../components/Doll.jsx";
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

  const [online, setOnline] = useState(true);
  const [lastIn, setLastIn] = useState(null);

  useEffect(() => {
    // The setup link carries the phone's key once (#key=...). Save it and remove it from the address bar.
    const m = /key=([^&]+)/.exec(window.location.hash);
    if (m) { try { localStorage.setItem("kioskKey", decodeURIComponent(m[1])); } catch {} history.replaceState(null, "", "/kiosk"); }
    const demo = /demo=(\w+)/.exec(window.location.hash)?.[1]; // #demo=look|check|in|out|fail|error|offline shows a screen without the camera
    if (demo) { const D = { look: { phase: "look", text: "Look at the camera" }, check: { phase: "check", text: "Checking…" }, in: { phase: "result", ok: true, text: "Welcome, Monika", sub: "Logged in 09:42 AM" }, out: { phase: "result", ok: true, text: "Goodbye, Monika", sub: "Logged out 06:31 PM · worked 8h 49m" }, fail: { phase: "result", ok: false, text: "Face not recognised", sub: "Face the light and look straight at the camera." }, error: { phase: "error", text: "Camera is blocked. Allow the camera and try again." }, offline: { phase: "offline", text: "No internet right now", sub: "Hold still. Trying again…" } }; setState(D[demo] || D.look); if (demo === "offline") setOnline(false); return; }
    let dead = false, stop = null, last = { id: "", at: 0 }, lock = null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const net = (e) => !e?.status; // no HTTP status means no internet (or a timeout), not a refusal from the server
    const camOk = () => { const t = video.current?.srcObject?.getVideoTracks?.()[0]; return !!t && t.readyState === "live"; };
    const ensureCamera = async () => { if (!camOk()) { try { stop?.(); } catch {} stop = await startCamera(video.current); } };
    const keepAwake = async () => { try { if (navigator.wakeLock && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen"); } catch {} };
    const onVis = () => { if (document.visibilityState === "visible") { keepAwake(); ensureCamera().catch(() => {}); } };
    document.addEventListener("visibilitychange", onVis);
    keepAwake();
    // Every minute: tell the server this phone is alive, and show whether the internet is reachable.
    const beat = setInterval(() => { kioskApi.call("ping").then(() => setOnline(true)).catch((e) => { if (net(e)) setOnline(false); }); }, 45000);
    window.addEventListener("online", () => setOnline(true));
    window.addEventListener("offline", () => setOnline(false));
    (async () => {
      try {
        if (!kioskApi.key()) throw new Error("NOKEY");
        let info;
        for (;;) { // start-up without internet: wait and keep trying instead of giving up
          try { info = await kioskApi.call("ping"); break; }
          catch (e) { if (!net(e)) throw e; if (dead) return; setOnline(false); setState({ phase: "offline", text: "Waiting for internet…", sub: "Check-in starts by itself when the signal is back." }); await sleep(4000); }
        }
        setOnline(true);
        if (info.enrolled === 0) { setState({ phase: "error", text: "No faces are enrolled yet. Ask the admin to enroll staff faces first." }); return; }
        for (let i = 0; ; i++) { try { await loadFace(); break; } catch (e) { if (i >= 5 || dead) throw e; await sleep(3000); } }
        await ensureCamera();
        setState({ phase: "look", text: "Look at the camera" });
        while (!dead) {
          await sleep(700);
          try {
            await ensureCamera();
            const f = await faceDescriptor(video.current).catch(() => null);
            if (!f) { setState((s) => (s.phase === "result" ? s : { phase: "look", text: "Look at the camera" })); continue; }
            if (Date.now() - last.at < 5000) continue; // keep showing the last result for a few seconds
            setState({ phase: "check", text: "Checking…" });
            const r = await kioskApi.call("checkin", { descriptor: f.descriptor, snapshot: snapshotJpeg(video.current) });
            setOnline(true);
            last = { at: Date.now() };
            const hm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
            if (r.matched) {
              const out = r.kind === "out";
              setLastIn({ name: r.name, time: r.time, out });
              setState({ phase: "result", ok: true,
                text: r.already ? `Already ${out ? "logged out" : "logged in"}, ${r.name}` : out ? `Goodbye, ${r.name}` : `Welcome, ${r.name}`,
                sub: r.already ? `${out ? "Out" : "In"} at ${r.time}` : out ? `Logged out ${r.time}${r.workedMinutes ? ` · worked ${hm(r.workedMinutes)}` : ""}${r.message ? ` · ${r.message}` : ""}` : `Logged in ${r.time} · ${r.label}` });
            } else setState({ phase: "result", ok: false, text: r.ambiguous ? "Please try again" : "Face not recognised", sub: r.ambiguous ? "Stand alone in front of the camera." : "Face the light and look straight at the camera. Ask the admin if it keeps happening." });
            setTimeout(() => setState((s) => (s.phase === "result" ? { phase: "look", text: "Look at the camera" } : s)), 4000);
          } catch (e) {
            if (dead) return;
            if (!net(e)) throw e; // the server refused (phone switched off, bad key): stop and say so
            // Weak or no internet: the person is not marked yet. Stay on screen and try the same face again in a moment.
            setOnline(false); last = { at: Date.now() - 3000 };
            setState({ phase: "offline", text: "No internet right now", sub: "Hold still. Trying again…" });
            await sleep(2000);
          }
        }
      } catch (e) {
        if (dead) return;
        setState({ phase: "error", text: e.message === "NOKEY" ? "This phone is not set up yet. Open the setup link from the admin." : e.status === 401 || e.status === 403 ? e.message : cameraHelp(e) });
      }
    })();
    return () => { dead = true; clearInterval(beat); document.removeEventListener("visibilitychange", onVis); try { lock?.release(); } catch {} stop?.(); };
  }, []);

  const out = state.ok && /^Goodbye|logged out/i.test(state.text || "");
  const mood = state.phase === "result" ? (state.ok ? (out ? "closing" : "celebrate") : "error") : state.phase === "error" || state.phase === "offline" ? "worried" : state.phase === "check" ? "idea" : "hello";
  const tone = state.phase === "result" ? (state.ok ? "ok" : "bad") : state.phase === "error" ? "bad" : state.phase === "check" || state.phase === "offline" ? "wait" : "look";
  return (
    <div className={`kiosk k-${tone}`}>
      <div className="kiosk-frame">
        <header className="kiosk-top">
          <img src="/logo.png" alt="" />
          <div className="kiosk-clock" style={{ position: "relative" }}><b>{clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</b><span>{clock.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></div>
        </header>
        <div className="kiosk-girl"><Doll mood={mood} size={200} follow={false} /></div>
        <div className="kiosk-cam">
          <video ref={video} playsInline muted />
          <i className="kc c1" /><i className="kc c2" /><i className="kc c3" /><i className="kc c4" />
          {tone === "look" && <span className="kscan" />}
        </div>
        {state.phase === "result" && state.ok && <div className="lumi-confetti" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ["#9472C8", "#FF9B7A", "#7DCB9F", "#F7C85C", "#FF6B8B"][i % 5], animationDelay: `${(i % 7) * 0.12}s` }} />)}</div>}
        <div className="kiosk-msg"><h2>{state.text}</h2>{state.sub && <p>{state.sub}</p>}</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, opacity: 0.85, margin: "6px 4px 0" }}>
          <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 99, marginRight: 6, background: online ? "#4cc38a" : "#f2a33a" }} />{online ? "Online" : "Weak internet"}</span>
          {lastIn && <span>Last: {lastIn.name} · {lastIn.out ? "out" : "in"} {lastIn.time}</span>}
        </div>
        {!standalone && (
          <div className="kiosk-install">
            <button onClick={install}>Install Check-in app</button>
            {showHow && <p>Tap the 3 dots at the top right of Chrome, then “Add to Home screen” and “Install”. On iPhone: tap Share, then “Add to Home Screen”.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
