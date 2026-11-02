import Icon from "./Icon.jsx";

// Lumi — the clinic helper: a soft round character with a sprout on top, happy eyes and pink cheeks.
// mood: "idle" | "wave" | "think" | "cheer" | "sorry"
export default function Lumi({ mood = "idle", size = 120, className = "" }) {
  const ink = "#3B2A4D";
  return (
    <svg className={`lumi lumi-${mood} ${className}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Lumi, the clinic helper">
      <defs>
        <radialGradient id="lumiBody" cx="40%" cy="28%" r="85%">
          <stop offset="0" stopColor="#FFFFFF" /><stop offset=".5" stopColor="#F3E6FB" /><stop offset="1" stopColor="#D6B8EE" />
        </radialGradient>
        <radialGradient id="lumiBelly" cx="50%" cy="40%" r="60%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#F5EAFC" /></radialGradient>
      </defs>
      <ellipse className="lumi-shadow" cx="60" cy="111" rx="28" ry="5" fill="#6B3F8C" opacity=".18" />
      <g className="lumi-all">
        {/* sprout */}
        <g className="lumi-sprout">
          <path d="M60 30c0-6 1-9 3-12" stroke="#B77AD6" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M63 18c2-7 9-8 12-6-1 6-6 9-12 6z" fill="#E9D2F7" stroke="#B77AD6" strokeWidth="2" strokeLinejoin="round" />
          <path d="M62 22c-1-5-6-7-10-5 0 5 4 8 10 5z" fill="#F3E6FB" stroke="#B77AD6" strokeWidth="2" strokeLinejoin="round" />
        </g>
        {/* feet */}
        <ellipse cx="46" cy="106" rx="9" ry="5" fill="#E4CBF5" /><ellipse cx="74" cy="106" rx="9" ry="5" fill="#E4CBF5" />
        {/* arms */}
        <ellipse className="lumi-arm-l" cx="25" cy="66" rx="8" ry="11" fill="#EBD7F8" transform="rotate(18 25 66)" />
        <ellipse className="lumi-arm-r" cx="95" cy="66" rx="8" ry="11" fill="#EBD7F8" transform="rotate(-18 95 66)" />
        {/* body */}
        <path d="M60 28c24 0 38 18 38 42 0 22-15 37-38 37S22 92 22 70c0-24 14-42 38-42z" fill="url(#lumiBody)" stroke="#CBA5E6" strokeWidth="1.6" />
        <ellipse cx="60" cy="90" rx="22" ry="15" fill="url(#lumiBelly)" />
        <ellipse cx="42" cy="46" rx="8" ry="5" fill="#fff" opacity=".7" transform="rotate(-25 42 46)" />
        {/* face */}
        <g className="lumi-eyes">
          {mood === "think" ? (<>
            <circle cx="47" cy="66" r="4.6" fill={ink} /><circle cx="73" cy="66" r="4.6" fill={ink} />
            <circle cx="48.6" cy="64.4" r="1.6" fill="#fff" /><circle cx="74.6" cy="64.4" r="1.6" fill="#fff" />
          </>) : mood === "sorry" ? (<>
            <path d="M41 68q6-6 12 0M67 68q6-6 12 0" stroke={ink} strokeWidth="3.4" strokeLinecap="round" fill="none" transform="rotate(0)" />
          </>) : (<>
            <path d="M41 67q6-8 12 0M67 67q6-8 12 0" stroke={ink} strokeWidth="3.6" strokeLinecap="round" fill="none" />
          </>)}
        </g>
        <ellipse cx="37" cy="78" rx="6" ry="3.6" fill="#F7A6C8" opacity=".7" /><ellipse cx="83" cy="78" rx="6" ry="3.6" fill="#F7A6C8" opacity=".7" />
        {mood === "sorry" ? <path d="M53 88q7-6 14 0" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          : mood === "think" ? <path d="M54 84q6 4 12 0" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          : <><path d="M51 79q9 14 18 0z" fill={ink} /><path d="M56 86q4 3 8 0q-4-2-8 0z" fill="#F28DB3" /></>}
      </g>
      {mood === "cheer" && <g className="lumi-sparks" fill="#E2B84F"><path d="M12 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M106 34l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><circle cx="20" cy="14" r="3" fill="#C58BE0" /><circle cx="102" cy="12" r="3" fill="#F7A6C8" /></g>}
      {mood === "think" && <g className="lumi-dots" fill="#B77AD6"><circle cx="92" cy="28" r="3" /><circle cx="100" cy="20" r="4" /><circle cx="110" cy="10" r="5" /></g>}
    </svg>
  );
}

// Lumi with the clinic's work icons circling her — used as the hero of the chatbot page.
const ORBIT = [["users", "#B452C5"], ["wallet", "#F2C56B"], ["clipboard", "#FFFFFF"], ["shield", "#B452C5"], ["list", "#FFFFFF"], ["calendarCheck", "#B452C5"]];
export function LumiOrbit({ mood = "idle", size = 190 }) {
  return (
    <div className="lumi-orbit" style={{ width: size, height: size }}>
      <div className="lumi-orbit-ring">
        {ORBIT.map(([icon, bg], i) => {
          const a = (i / ORBIT.length) * 2 * Math.PI - Math.PI / 2, r = 41;
          return <span key={icon} className="lumi-orbit-dot" style={{ left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%`, background: bg, color: bg === "#FFFFFF" ? "#B452C5" : "#fff" }}><Icon name={icon} size={Math.round(size / 10)} /></span>;
        })}
      </div>
      <div className="lumi-orbit-mid"><Lumi mood={mood} size={Math.round(size * 0.62)} /></div>
    </div>
  );
}
