import { useEffect, useRef, useState } from "react";
import ClinicMate, { lookFor } from "./ClinicMate.jsx";

// The assistant. One picture (public/hero-girl.webp) is moved in layers: she breathes, her head follows the pointer,
// and each state adds its own motion and a small bubble. The face itself does not change (see the note in the README of this change).
// States: idle, welcome, happy, thinking, working, success, closing, notify, error, sleepy, goodbye.
export const doll = (state, ms = 2800) => window.dispatchEvent(new CustomEvent("doll", { detail: { state, ms } }));

const BUBBLE = { welcome: "Hi!", thinking: "…", notify: "!", error: "?", goodbye: "Bye!", success: "Yay!", closing: "Done!", sleepy: "z z z" };
const SPARK = ["success", "closing", "happy"];
const MATE = { welcome: "wave", goodbye: "wave", happy: "happy", success: "celebrate", closing: "celebrate", thinking: "think", error: "think", sleepy: "calm", notify: "wink" };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function Doll({ size = 210, mood = "idle", follow = true, className = "", userId }) {
  const [temp, setTemp] = useState(null), [ok, setOk] = useState(true), wrap = useRef(null), tilt = useRef(null);
  const state = temp || mood;

  useEffect(() => { // a short reaction to something that happened, then back to rest
    let t; const f = (e) => { const { state: s, ms = 2800 } = e.detail || {}; if (!s) return; setTemp(s); clearTimeout(t); t = setTimeout(() => setTemp(null), ms); };
    window.addEventListener("doll", f); return () => { window.removeEventListener("doll", f); clearTimeout(t); };
  }, []);

  useEffect(() => { // the head turns a little toward the pointer
    if (!follow || reduced()) return; let raf;
    const move = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = wrap.current?.getBoundingClientRect(), el = tilt.current; if (!r || !el) return;
        const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 600)), dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 400));
        el.style.transform = `perspective(700px) rotateY(${dx * 9}deg) rotateX(${-dy * 6}deg) translate(${dx * 5}px, ${dy * 3}px)`;
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, [follow]);

  if (!ok) return <ClinicMate look={lookFor(userId)} mood={MATE[state] || "happy"} size={Math.round(size * 0.7)} className={className} />;
  return (
    <div ref={wrap} className={`doll s-${state} ${className}`} style={{ width: size }}>
      <div className="doll-tilt" ref={tilt}>
        <img src="/hero-girl.webp" alt="" loading="lazy" decoding="async" draggable="false" onError={() => setOk(false)} />
      </div>
      {BUBBLE[state] && <span key={state} className={`doll-bubble b-${state}`}>{BUBBLE[state]}</span>}
      {SPARK.includes(state) && <span key={"sp" + state} className="doll-sparks" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ "--i": i }} />)}</span>}
    </div>
  );
}
