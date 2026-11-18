import { useEffect, useRef, useState } from "react";
import ClinicMate, { lookFor } from "./ClinicMate.jsx";

// The assistant. Each state shows its own picture of her (public/dolls), swapped with a soft fade, and moves a little on top.
// Her head also turns toward the pointer. The pictures are stills, so the face changes come from swapping pictures.
export const doll = (state, ms = 2800) => window.dispatchEvent(new CustomEvent("doll", { detail: { state, ms } }));

const D = "/dolls/";
const IMG = {
  idle: "/hero-girl.webp",
  welcome: D + "s-welcome.webp", happy: D + "s-happy.webp", excited: D + "s-excited.webp",
  thinking: D + "think.webp", working: D + "laptop.webp", music: D + "music.webp",
  success: D + "s-success.webp", closing: D + "wave.webp", goodbye: D + "wave.webp",
  celebrate: D + "celebrate.webp", birthday: D + "s-celebrating.webp",
  notify: D + "s-surprised.webp", error: D + "s-confused.webp", sleepy: D + "s-sleepy.webp",
  tired: D + "s-tired.webp", idea: D + "s-idea.webp", worried: D + "s-worried.webp", sick: D + "s-sick.webp", hungry: D + "s-hungry.webp", angry: D + "s-angry.webp",
};
const TALL = new Set([D + "think.webp", D + "laptop.webp", D + "music.webp", D + "wave.webp", D + "celebrate.webp"]); // full-body: show head and body
const BUBBLE = { welcome: "Hi!", goodbye: "Bye!", closing: "Done!" };
const SPARK = { success: 6, closing: 6, celebrate: 14, birthday: 14, excited: 6 };
const MATE = { welcome: "wave", goodbye: "wave", happy: "happy", success: "celebrate", closing: "celebrate", celebrate: "celebrate", thinking: "think", error: "think", sleepy: "calm", notify: "wink" };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let warmed = false;
const warm = () => { if (warmed) return; warmed = true; const go = () => Object.values(IMG).forEach((u) => { const i = new Image(); i.src = u; }); (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(go); };

export default function Doll({ size = 210, mood = "idle", follow = true, className = "", userId }) {
  const [temp, setTemp] = useState(null), [ok, setOk] = useState(true), wrap = useRef(null), tilt = useRef(null);
  const state = temp || mood, src = IMG[state] || IMG.idle, tall = TALL.has(src);
  useEffect(warm, []);

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
    <div ref={wrap} className={`doll s-${state} ${className}`} style={{ width: size, height: Math.round(size * 0.92) }}>
      <div className="doll-tilt" ref={tilt}>
        <div className="doll-swap" key={src}>
          <img src={src} alt="" decoding="async" draggable="false" className={tall ? "tall" : "fit"} onError={() => setOk(false)} />
        </div>
      </div>
      {BUBBLE[state] && <span key={state} className={`doll-bubble b-${state}`}>{BUBBLE[state]}</span>}
      {SPARK[state] && <span key={"sp" + state} className={`doll-sparks n${SPARK[state]}`} aria-hidden="true">{Array.from({ length: SPARK[state] }, (_, i) => <i key={i} style={{ "--i": i }} />)}</span>}
    </div>
  );
}
