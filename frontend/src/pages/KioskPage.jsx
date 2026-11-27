import { useEffect, useRef, useState } from "react";
import Doll from "../components/Doll.jsx";
import { kioskApi } from "../api.js";
import { scanFace, startCamera, cameraHelp, loadFace, snapshotJpeg } from "../face.js";

// Clinic-phone screen: staff look at the camera and are marked present. No login, no buttons for staff.
const t12 = (t) => { if (!t) return ""; const [h, m] = String(t).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export default function KioskPage() {
  const video = useRef(null);
  const [state, setState] = useState({ phase: "start", text: "Starting…" });
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  // Make this page installable as its own "Attendance" app (separate from the Work Hub app).
  const [installEvt, setInstallEvt] = useState(null);
  const [showHow, setShowHow] = useState(false);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone);
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const old = link?.getAttribute("href");
    const hk = /[?#&]key=([^&#]+)/.exec(window.location.search + window.location.hash)?.[1] || (() => { try { return encodeURIComponent(localStorage.getItem("kioskKey") || ""); } catch { return ""; } })();
    link?.setAttribute("href", "/kiosk.webmanifest" + (hk ? "?key=" + hk : ""));
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); if (old) link?.setAttribute("href", old); };
  }, []);
  const install = async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); setInstallEvt(null); }
    else setShowHow((v) => !v);
  };

  useEffect(() => { // the screen is exactly as tall as the visible phone screen and never scrolls
    const root = document.documentElement, fit = () => root.style.setProperty("--kh", `${window.innerHeight}px`);
    const meta = document.querySelector('meta[name="viewport"]'), oldMeta = meta?.getAttribute("content");
    meta?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"); // no pinch or double-tap zoom on the clinic phone
    root.classList.add("kiosk-lock"); fit();
    const still = (e) => { if (!e.target.closest?.("button, input, a")) e.preventDefault(); }, home = () => window.scrollTo(0, 0);
    document.addEventListener("touchmove", still, { passive: false }); window.addEventListener("scroll", home);
    window.addEventListener("resize", fit); window.addEventListener("orientationchange", fit);
    return () => { root.classList.remove("kiosk-lock"); root.style.removeProperty("--kh"); if (oldMeta) meta?.setAttribute("content", oldMeta); document.removeEventListener("touchmove", still); window.removeEventListener("scroll", home); window.removeEventListener("resize", fit); window.removeEventListener("orientationchange", fit); };
  }, []);
  const confirmRef = useRef(null), undoRef = useRef(null);
  const [online, setOnline] = useState(true);
  const [lastIn, setLastIn] = useState(null);
  const [today, setToday] = useState(null);

  useEffect(() => {
    // The setup link carries the phone's key (#key=...). Save it, and keep it in the address for iPhone home-screen icons.
    const k0 = kioskApi.key(); // saves the key and, on an old #key= link, moves it to ?key= (iPhone keeps the query when adding to the home screen)
    if (k0 && !/[?&]key=/.test(window.location.search)) { try { history.replaceState(null, "", "/kiosk?key=" + encodeURIComponent(k0)); } catch {} } // the key stays in the address so "Add to Home Screen" on an iPhone keeps it
    const demo = /demo=(\w+)/.exec(window.location.hash)?.[1]; // #demo=look|check|in|out|fail|error|offline shows a screen without the camera
    if (demo) { const D = { look: { phase: "look", text: "Look at the camera" }, check: { phase: "check", text: "Checking…" }, in: { phase: "result", ok: true, text: "Welcome, Monika", sub: "In Time recorded 09:42 AM" }, out: { phase: "result", ok: true, text: "Goodbye, Monika", sub: "Out Time recorded 06:31 PM · worked 8h 49m" }, fail: { phase: "result", ok: false, text: "Face not recognised", sub: "Face the light and look straight at the camera." }, error: { phase: "error", text: "Camera is blocked. Allow the camera and try again." }, offline: { phase: "offline", text: "No internet right now", sub: "Hold still. Trying again…" } }; setState(D[demo] || D.look); setToday({ count: 12, recent: [{ name: "Monika", kind: "in", time: "09:42" }, { name: "Praneeth", kind: "in", time: "09:40" }, { name: "Kavya", kind: "out", time: "09:12" }] }); if (demo === "offline") setOnline(false); return; }
    let dead = false, stop = null, last = { id: "", at: 0 }, lock = null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const net = (e) => !e?.status; // no HTTP status means no internet (or a timeout), not a refusal from the server
    const camOk = () => { const t = video.current?.srcObject?.getVideoTracks?.()[0]; return !!t && t.readyState === "live"; };
    const ensureCamera = async () => { if (!camOk()) { try { stop?.(); } catch {} stop = await startCamera(video.current); } };
    const keepAwake = async () => { try { if (navigator.wakeLock && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen"); } catch {} };
    const onVis = () => { if (document.visibilityState === "visible") { keepAwake(); ensureCamera().catch(() => {}); } };
    document.addEventListener("visibilitychange", onVis);
    keepAwake();
    // Attendance works only at the clinic: when the admin switches the location limit on, this phone shares where it is.
    let geoOn = false, pos = null, posErr = 0, watch = null;
    const startGeo = () => { if (watch !== null || !navigator.geolocation) return; try { watch = navigator.geolocation.watchPosition((p) => { posErr = 0; pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; }, (e) => { posErr = e.code || 2; }, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 }); } catch {} };
    // Every minute: tell the server this phone is alive, and show whether the internet is reachable.
    const loadToday = () => kioskApi.call("today").then(setToday).catch(() => {});
    const beat = setInterval(() => { loadToday(); kioskApi.call("ping").then((r) => { setOnline(true); geoOn = !!r.geo; if (geoOn) startGeo(); }).catch((e) => { if (net(e)) setOnline(false); }); }, 45000);
    window.addEventListener("online", () => setOnline(true));
    window.addEventListener("offline", () => setOnline(false));
    (async () => {
      try {
        if (!kioskApi.key()) throw new Error("NOKEY");
        // Everything starts at the same time: the face models, the camera and the server check. (Before, they ran one after the other.)
        const faceP = (async () => { for (let i = 0; ; i++) { try { return await loadFace(); } catch (e) { if (i >= 5 || dead) throw e; await sleep(3000); } } })();
        faceP.catch(() => {});
        const camP = ensureCamera().then(() => null, (e) => e);
        let info;
        for (;;) { // start-up without internet: wait and keep trying instead of giving up
          try { info = await kioskApi.call("ping"); break; }
          catch (e) { if (!net(e)) throw e; if (dead) return; setOnline(false); setState({ phase: "offline", text: "Waiting for internet…", sub: "Attendance starts by itself when the signal is back." }); await sleep(4000); }
        }
        setOnline(true); loadToday();
        geoOn = !!info.geo; if (geoOn) startGeo();
        if (info.enrolled === 0) { setState({ phase: "error", text: "No faces are enrolled yet. Ask the admin to enroll staff faces first." }); return; }
        setState({ phase: "start", text: "Getting ready…", sub: "Loading the face scanner" });
        await faceP;
        const camErr = await camP; if (camErr) throw camErr;
        await ensureCamera();
        setState({ phase: "look", text: "Look at the camera" });
        const hm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
        const askOut = (r, payload) => { // a look long before the end of the shift: ask first, record nothing until they say yes
          last = { at: Date.now() + 12000 };
          const timer = setTimeout(() => { if (confirmRef.current) { confirmRef.current = null; last = { at: Date.now() }; setState({ phase: "look", text: "Look at the camera" }); } }, 10000);
          confirmRef.current = {
            yes: async () => { clearTimeout(timer); confirmRef.current = null; setState({ phase: "check", text: "Recording Out Time…" });
              try { const r2 = await kioskApi.call("checkin", { ...payload, confirmOut: true }); last = { at: Date.now() }; showResult(r2, payload); } catch (e) { last = { at: Date.now() }; setState({ phase: "result", ok: false, text: "Please try again", sub: e.message }); } },
            no: () => { clearTimeout(timer); confirmRef.current = null; last = { at: Date.now() + 8000 }; setState({ phase: "look", text: "Look at the camera" }); },
          };
          setState({ phase: "confirm", text: `Leaving now, ${r.name}?`, sub: `You punched in at ${t12(r.inTime)}. Tap Yes only if you are going home.` });
        };
        let lastOk = null; // the last recorded person, so the "Not me" button stays while they stand there
        undoRef.current = async (id) => {
          try { await kioskApi.call("undo", { id }); } catch (e) { setState({ phase: "result", ok: false, text: "Could not cancel", sub: e.message }); return; }
          lastOk = null; last = { at: Date.now() + 1500 }; setLastIn(null); setTimeout(loadToday, 400);
          setState({ phase: "result", ok: false, text: "Cancelled", sub: "Nothing was recorded. Please look at the camera again." });
          setTimeout(() => setState((s) => (s.phase === "result" ? { phase: "look", text: "Look at the camera" } : s)), 3000);
        };
        const showResult = (r, payload) => {
          if (r.matched && !r.confirmOut) setTimeout(loadToday, 400);
          if (r.confirmOut) { askOut(r, payload); return; }
          if (r.matched && r.already && lastOk && lastOk.name === r.name && Date.now() - lastOk.at < 6500) return; // same person still in front of the camera: keep the first answer on screen
            if (r.matched) {
              const out = r.kind === "out";
              const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
              setLastIn({ name: r.name, time: t12(r.time), out });
              if (!r.already) lastOk = { name: r.name, at: Date.now() };
              setState({ phase: "result", ok: true, out, undoId: r.undoId,
                text: r.already ? r.name : out ? `Thank you, ${r.name}` : `${greet}, ${r.name}`,
                sub: r.already ? `${out ? "Out Time" : "In Time"} already recorded at ${t12(r.time)}` : out ? `Out Time recorded at ${t12(r.time)}${r.workedMinutes ? ` · Worked ${hm(r.workedMinutes)}` : ""}${r.message ? ` · ${r.message}` : ""}` : `In Time recorded at ${t12(r.time)} · ${r.label}${r.late ? ` · ${r.late} min late. Please add the reason in the Work Hub app.` : ""}` });
            } else if (r.needLocation) setState({ phase: "result", ok: false, text: "Location is needed", sub: "Allow Location for this website and try again." });
            else if (r.outside) setState({ phase: "result", ok: false, text: "You are outside the clinic", sub: "Attendance works only at the clinic." });
            else setState({ phase: "result", ok: false, text: r.ambiguous ? "Please try again" : "Face not recognised", sub: r.ambiguous ? "Stand alone in front of the camera and look straight at it." : "Face the light and look straight at the camera. Ask the admin if it keeps happening." });
          if (!r.matched) last = { at: Date.now(), hold: 1200 }; // not recognised: look again almost at once
          setTimeout(() => setState((s) => (s.phase === "result" ? { phase: "look", text: "Look at the camera" } : s)), r.matched && !r.already ? 6000 : r.matched ? 3000 : 2000);
        };
        let prev = null; // the previous good look: two looks in a row must agree, and the second one is simply the next frame (no extra waiting)
        while (!dead) {
          await sleep(prev ? 30 : 150); // a face is in view: scan flat out; nobody there: relax
          try {
            await ensureCamera();
            const f = await scanFace(video.current, "kiosk").catch(() => null);
            if (!f || !f.ok) { prev = null; const tip = f?.why === "far" ? "Come a little closer" : f?.why === "close" ? "Move back a little" : "Look at the camera"; setState((s) => (s.phase === "result" || s.phase === "confirm" ? s : s.text === tip ? s : { phase: "look", text: tip })); continue; }
            if (Date.now() - last.at < (last.hold ?? 2800)) { prev = null; continue; } // keep showing the last result for a moment
            if (geoOn && (!pos || Date.now() - pos.at > 10 * 60000)) { setState({ phase: "error", text: posErr === 1 ? "Location is blocked" : "Getting the clinic location…", sub: posErr === 1 ? "Allow Location for this website (iPhone: Settings → Privacy → Location Services → Safari Websites), then try again." : "Please wait a moment." }); await sleep(1500); continue; }
            const snap = snapshotJpeg(video.current, 200), posBody = geoOn && pos ? { lat: pos.lat, lng: pos.lng, acc: pos.acc } : undefined;
            if (prev && Date.now() - prev.at > 2500) prev = null;
            // First look: sent alone. A very clear match is accepted by the server at once; otherwise it asks for a second look, and both must agree.
            if (!prev) {
              setState({ phase: "check", text: "Checking…" });
              const r0 = await kioskApi.call("checkin", { descriptor: f.descriptor, fast: true, snapshot: snap, pos: posBody });
              setOnline(true);
              if (r0.again) { prev = { d: f.descriptor, at: Date.now() }; continue; }
              last = { at: Date.now() }; showResult(r0, { descriptor: f.descriptor, fast: true, snapshot: snap, pos: posBody }); continue;
            }
            const f1 = { descriptor: prev.d }, f2 = f; prev = null;
            const body = { descriptor: f1.descriptor, descriptors: [f1.descriptor, f2.descriptor], snapshot: snap, pos: posBody };
            const r = await kioskApi.call("checkin", body);
            setOnline(true);
            last = { at: Date.now() };
            showResult(r, body);
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

  const [paste, setPaste] = useState("");
  const saveSetup = () => { // fallback for an iPhone home-screen icon that lost the key: paste the setup link here once
    const m = /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/.exec(paste.replace(/\s/g, ""));
    if (!m) { setState({ phase: "error", text: "That is not the setup link. Copy the whole link and paste it here." }); return; }
    try { localStorage.setItem("kioskKey", m[1]); } catch {}
    window.location.reload();
  };
  const out = !!(state.ok && state.out);
  const mood = state.phase === "result" ? (state.ok ? (out ? "closing" : "celebrate") : "error") : state.phase === "error" || state.phase === "offline" ? "worried" : state.phase === "check" ? "idea" : "hello";
  const tone = state.phase === "result" ? (state.ok ? "ok" : "bad") : state.phase === "error" ? "bad" : state.phase === "check" || state.phase === "offline" || state.phase === "confirm" ? "wait" : "look";
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
          {tone === "look" && <i className="kguide" />}
        </div>
        {state.phase === "result" && state.ok && <div className="lumi-confetti" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ["#9472C8", "#FF9B7A", "#7DCB9F", "#F7C85C", "#FF6B8B"][i % 5], animationDelay: `${(i % 7) * 0.12}s` }} />)}</div>}
        <div className="kiosk-msg"><h2>{state.text}</h2>{state.sub && <p>{state.sub}</p>}</div>
        {state.phase === "result" && state.ok && state.undoId && (
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 2px" }}>
            <button className="btn btn-outline btn-sm" onClick={() => undoRef.current?.(state.undoId)}>Not me? Tap to cancel</button>
          </div>
        )}
        {state.phase === "confirm" && (
          <div style={{ display: "flex", gap: 10, margin: "10px 0 4px" }}>
            <button className="btn btn-primary" style={{ flex: 1, padding: "14px 8px", fontSize: 16 }} onClick={() => confirmRef.current?.yes()}>Yes, I am leaving</button>
            <button className="btn btn-outline" style={{ flex: 1, padding: "14px 8px", fontSize: 16 }} onClick={() => confirmRef.current?.no()}>No</button>
          </div>
        )}
        {state.phase === "error" && !kioskApi.key() && (
          <div className="kiosk-install">
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the setup link here" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #cdbbe6", fontSize: 16 }} />
            <button onClick={saveSetup} style={{ marginTop: 8 }}>Save setup</button>
          </div>
        )}
        {showHow && !standalone && <p className="kiosk-hint">Tap the 3 dots at the top right of Chrome, then “Add to Home screen” and “Install”. On iPhone: tap Share, then “Add to Home Screen”.</p>}
        <div className="kiosk-today">
          <div className="kt-head"><b>Today</b><span>{today ? (today.count ? `${today.count} registered` : "No one registered yet") : "…"}</span></div>
          {today?.recent?.map((r, i) => <div key={i} className="kt-row"><span>{r.name}</span><em className={r.kind === "out" ? "out" : "in"}>{r.kind === "out" ? "Out" : "In"} {t12(r.time)}</em></div>)}
        </div>
        <div className="kiosk-bar">
          <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 99, marginRight: 6, background: online ? "#4cc38a" : "#f2a33a" }} />{online ? "Online" : "Weak internet"}</span>
          {!standalone && <button className="kb-install" onClick={install}>Install app</button>}
        </div>
      </div>
    </div>
  );
}
