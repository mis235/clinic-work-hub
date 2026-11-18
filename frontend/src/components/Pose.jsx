import { useId } from "react";

// The assistant in four poses. The head is the real head from the approved picture (public/hero-head.webp), so the face is always hers;
// the bodies are drawn. The face itself does not change expression.
// pose: stand | walk | music | laptop      face: smile | happy | wink | focus | wow | sleepy
const HAIR = "#7A4026", HAIR_L = "#9A5A38", SKIN = "#F8D0B2", SKIN_D = "#EBB08A", HOOD = "var(--pz-hood)", HOOD_D = "var(--pz-hood-d)", PANTS = "#6C5AA8", PHONES = "var(--pz-phones)";
const DEFAULT_FACE = { stand: "smile", walk: "happy", music: "happy", laptop: "focus" };

function Eye({ cx, kind, look }) {
  const ox = look.x, oy = look.y;
  if (kind === "happy") return <path d={`M${cx - 8} 95 Q${cx} 84 ${cx + 8} 95`} stroke="#2B1B3A" strokeWidth="3.4" fill="none" strokeLinecap="round" />;
  if (kind === "closed") return <path d={`M${cx - 8} 91 Q${cx} 98 ${cx + 8} 91`} stroke="#2B1B3A" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
  const big = kind === "wow" ? 1.12 : 1;
  return (
    <g className="pz-eye" style={{ transformOrigin: `${cx}px 92px` }}>
      <ellipse cx={cx} cy="92" rx={9.5 * big} ry={10.5 * big} fill="#fff" />
      <ellipse cx={cx + ox} cy={93 + oy} rx={7 * big} ry={8 * big} fill="url(#pz-iris)" />
      <ellipse cx={cx + ox} cy={93.6 + oy} rx="3.4" ry="4.2" fill="#1E1230" />
      <circle cx={cx + ox + 2.8} cy={90 + oy} r="2.6" fill="#fff" /><circle cx={cx + ox - 2.4} cy={97 + oy} r="1.3" fill="#fff" opacity=".85" />
      <path d={`M${cx - 10} 88 Q${cx} 81 ${cx + 10} 88`} stroke="#2B1B3A" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d={cx < 120 ? `M${cx - 9} 88 l-5 -3 M${cx - 10} 92 l-5.5 -.8` : `M${cx + 9} 88 l5 -3 M${cx + 10} 92 l5.5 -.8`} stroke="#2B1B3A" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Face({ face }) {
  const eyes = { smile: ["open", "open"], happy: ["happy", "happy"], wink: ["open", "closed"], focus: ["open", "open"], wow: ["wow", "wow"], sleepy: ["closed", "closed"] }[face] || ["open", "open"];
  const look = face === "focus" ? { x: 0, y: 3 } : { x: 0, y: 0 };
  const up = face === "wow" ? -5 : 0, low = face === "focus" ? 2 : 0;
  return (
    <g>
      <path d={`M93 ${77 + up + low} Q104 ${71 + up} 114 ${76 + up}`} stroke={HAIR} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d={`M126 ${76 + up} Q136 ${71 + up} 147 ${77 + up + low}`} stroke={HAIR} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <Eye cx={103} kind={eyes[0]} look={look} /><Eye cx={137} kind={eyes[1]} look={look} />
      <ellipse cx="90" cy="108" rx="11" ry="7" fill="#FF8FA9" opacity=".5" /><ellipse cx="150" cy="108" rx="11" ry="7" fill="#FF8FA9" opacity=".5" />
      <ellipse cx="120" cy="104" rx="3.4" ry="2.4" fill={SKIN_D} opacity=".7" />
      {face === "happy" ? <g><path d="M106 113 Q120 134 134 113 Z" fill="#8E2F48" stroke="#8E2F48" strokeWidth="2" strokeLinejoin="round" /><ellipse cx="120" cy="125" rx="6" ry="3.2" fill="#FF8FA9" /></g>
        : face === "wow" ? <ellipse cx="120" cy="120" rx="5.4" ry="6.6" fill="#8E2F48" />
        : face === "focus" || face === "sleepy" ? <path d="M113 118 Q120 121 127 118" stroke="#B5546F" strokeWidth="3" fill="none" strokeLinecap="round" />
        : <g><path d="M107 114 Q120 126 133 114" stroke="#B5546F" strokeWidth="3.4" fill="none" strokeLinecap="round" /><ellipse cx="121" cy="120" rx="4" ry="1.2" fill="#fff" opacity=".5" /></g>}
    </g>
  );
}

const Arm = ({ d, hand }) => (
  <g>
    <path d={d} stroke={HOOD} strokeWidth="25" fill="none" strokeLinecap="round" />
    <path d={d} stroke="#fff" strokeOpacity=".16" strokeWidth="8" fill="none" strokeLinecap="round" transform="translate(-4 -3)" />
    {hand && <><circle cx={hand[0]} cy={hand[1]} r="13" fill={HOOD_D} /><circle cx={hand[0] + (hand[2] || 0)} cy={hand[1] + 6} r="9.5" fill={SKIN} /></>}
  </g>
);
const Legs = () => (<>
  <g className="pz-legL" style={{ transformOrigin: "104px 218px" }}><rect x="91" y="212" width="26" height="58" rx="13" fill={PANTS} /><ellipse cx="102" cy="274" rx="18" ry="8.5" fill="#fff" stroke="#E4DAF5" strokeWidth="2" /></g>
  <g className="pz-legR" style={{ transformOrigin: "136px 218px" }}><rect x="123" y="212" width="26" height="58" rx="13" fill={PANTS} /><ellipse cx="138" cy="274" rx="18" ry="8.5" fill="#fff" stroke="#E4DAF5" strokeWidth="2" /></g>
</>);

export default function Pose({ pose = "stand", face, size = 170, className = "" }) {
  const f = face || DEFAULT_FACE[pose] || "smile", id = useId().replace(/:/g, "");
  const laptop = pose === "laptop";
  return (
    <svg viewBox="0 -14 240 314" width={size} height={size * 1.31} className={`pz pz-${pose} ${className}`} role="img" aria-label={`Assistant ${pose}`}>
      <defs>
        <radialGradient id="pz-iris" cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#B7794A" /><stop offset=".6" stopColor="#6B3B22" /><stop offset="1" stopColor="#3A1D10" /></radialGradient>
        <radialGradient id={`h${id}`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fff" stopOpacity=".6" /><stop offset=".3" stopColor={SKIN} /><stop offset="1" stopColor={SKIN_D} /></radialGradient>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--pz-hood-l)" /><stop offset="1" stopColor={HOOD_D} /></linearGradient>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F1EEF8" /><stop offset="1" stopColor="#D5CFE6" /></linearGradient>
        <filter id={`s${id}`}><feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#4B2FA0" floodOpacity=".25" /></filter>
      </defs>
      {!laptop && <ellipse cx="120" cy="284" rx="60" ry="8" fill="#6A47B8" opacity=".16" />}
      <g className="pz-body" filter={`url(#s${id})`}>
        {!laptop && <Legs />}
        {/* arms behind/beside body */}
        {pose === "stand" && <><Arm d="M80 154 Q70 184 74 206" hand={[74, 206, 0]} /><Arm d="M160 154 Q170 184 166 206" hand={[166, 206, 0]} /></>}
        {pose === "walk" && <>
          <g className="pz-armL" style={{ transformOrigin: "80px 152px" }}><Arm d="M80 154 Q72 184 76 208" hand={[76, 208, 0]} /></g>
          <g className="pz-armR" style={{ transformOrigin: "160px 152px" }}><Arm d="M160 154 Q168 184 164 208" hand={[164, 208, 0]} /></g></>}
        {pose === "music" && <><Arm d="M80 154 Q46 150 56 112" hand={[56, 104, 3]} /><Arm d="M160 154 Q172 184 168 208" hand={[168, 208, 0]} /></>}
        {laptop && <>
          <g className="pz-typeL"><Arm d="M82 156 Q80 176 98 196" /></g><g className="pz-typeR"><Arm d="M158 156 Q160 176 142 196" /></g></>}
        {/* torso */}
        <ellipse cx="120" cy="138" rx="36" ry="15" fill={HOOD_D} />
        <path d="M72 150 Q72 134 100 134 L140 134 Q168 134 168 150 L174 222 Q120 236 66 222 Z" fill={`url(#b${id})`} />
        <path d="M100 134 Q120 150 140 134" stroke={HOOD_D} strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M108 146 L106 176 M132 146 L134 176" stroke="#E7D8FB" strokeWidth="3.4" strokeLinecap="round" />
        {pose !== "laptop" && <rect x="90" y="196" width="60" height="22" rx="11" fill={HOOD_D} opacity=".45" />}
        <rect x="108" y="122" width="24" height="22" rx="10" fill={SKIN_D} />
        {/* head */}
        <g className="pz-head" style={{ transformOrigin: "120px 132px" }}>
          <image href="/hero-head.webp" x="21" y="-4" width="170" height="149" preserveAspectRatio="xMidYMid meet" />
        </g>
      </g>
      {laptop && <g>
        <path d="M66 182 H174 Q180 182 180 188 V240 H60 V188 Q60 182 66 182Z" fill={`url(#l${id})`} stroke="#CFC8E3" strokeWidth="2" />
        <circle cx="120" cy="212" r="8" fill="#C9C3DD" />
        <rect x="6" y="238" width="228" height="62" rx="16" fill="#EADCF8" /><rect x="6" y="238" width="228" height="8" rx="4" fill="#fff" opacity=".7" />
      </g>}
      {pose === "music" && <g className="pz-notes" fill="#9C7FEA" fontSize="26" fontWeight="700"><text x="178" y="90">♪</text><text x="196" y="60" fill="#F58AA5">♫</text><text x="170" y="40" fill="#F6B93B">♪</text></g>}
    </svg>
  );
}
