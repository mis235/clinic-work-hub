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
  hello: D + "wave.webp", wrong: D + "think.webp",
  celebrate: D + "celebrate.webp", birthday: D + "celebrate.webp",
  notify: D + "s-surprised.webp", error: D + "s-confused.webp", sleepy: D + "s-sleepy.webp",
  tired: D + "s-tired.webp", idea: D + "s-idea.webp", worried: D + "s-worried.webp", sick: D + "s-sick.webp", pet: D + "s-happy.webp", grumpy: D + "s-angry.webp", hungry: D + "s-hungry.webp", angry: D + "s-angry.webp",
};
const TALL = new Set([D + "wave.webp", D + "think.webp", D + "laptop.webp", D + "music.webp", D + "wave.webp", D + "celebrate.webp"]); // full-body: show head and body
const BUBBLE = { pet: "Hehe!", grumpy: "Hey!", hungry: "Lunch?", sleepy: "Zzz", hello: "Hello!", wrong: "?", welcome: "Hi!", goodbye: "Bye!", closing: "Done!" };
const SPARK = { pet: 6, success: 6, closing: 6, celebrate: 14, birthday: 14, excited: 6 };
const MATE = { welcome: "wave", goodbye: "wave", happy: "happy", success: "celebrate", closing: "celebrate", celebrate: "celebrate", thinking: "think", error: "think", sleepy: "calm", notify: "wink" };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let warmed = false;
const warm = () => { if (warmed) return; warmed = true; const go = () => Object.values(IMG).forEach((u) => { const i = new Image(); i.src = u; }); (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(go); };

export default function Doll({ size = 210, mood = "idle", follow = true, className = "", userId, pet = false }) {
  const [temp, setTemp] = useState(null), [ok, setOk] = useState(true), wrap = useRef(null), tilt = useRef(null);
  const state = temp || mood, src = IMG[state] || IMG.idle, tall = TALL.has(src);
  useEffect(warm, []);
  const taps = useRef({ n: 0, t: 0 }), tm = useRef(null);
  const react = (st, ms) => { setTemp(st); clearTimeout(tm.current); tm.current = setTimeout(() => setTemp(null), ms); };
  const poke = () => { // tap her like a pet: happy, then excited, and grumpy if poked too much
    if (!pet) return; const now = Date.now(), k = taps.current; k.n = now - k.t < 4000 ? k.n + 1 : 1; k.t = now;
    react(k.n >= 7 ? "grumpy" : k.n >= 3 ? "excited" : "pet", k.n >= 7 ? 1800 : 2200);
  };
  useEffect(() => { // when nobody is doing anything she changes by herself now and then
    if (!pet || reduced()) return; const pool = ["happy", "music", "idea", "excited", "idle"];
    const id = setInterval(() => { if (document.hidden) return; react(pool[Math.floor(Math.random() * pool.length)], 3200); }, 28000);
    return () => { clearInterval(id); clearTimeout(tm.current); };
  }, [pet]);

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
    <div ref={wrap} className={`doll s-${state} ${pet ? "pet" : ""} ${className}`} onClick={poke} style={{ width: size, height: Math.round(size * 0.92) }}>
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
