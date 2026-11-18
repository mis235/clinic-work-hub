import { useId } from "react";

// A friendly clay-style clinic character, drawn for this app. Each person gets a look (skin, hair, outfit) and a mood.
// moods: wave, happy, wink, think, celebrate, calm
export const LOOKS = [
  { skin: "#F6C9A8", skinDark: "#E9AE88", hair: "#3B2418", style: "bun", top: "#8D72E0", coat: true },
  { skin: "#E3A982", skinDark: "#CF8E66", hair: "#1F1712", style: "short", top: "#5B9BE8", coat: true },
  { skin: "#F9D3BA", skinDark: "#EDB898", hair: "#7A3E1D", style: "long", top: "#F08FB5", coat: false },
  { skin: "#C98B65", skinDark: "#B2724D", hair: "#15100D", style: "bun", top: "#4FBF9B", coat: true },
];
export const lookFor = (key = "") => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return LOOKS[h % LOOKS.length]; };

function Eyes({ mood }) {
  const open = (cx) => (<g key={cx}><ellipse cx={cx} cy="94" rx="7" ry="8.4" fill="#fff" /><ellipse cx={cx} cy="95" rx="5.6" ry="7" fill="url(#iris)" /><ellipse cx={cx} cy="95.5" rx="2.8" ry="3.6" fill="#1E1230" /><circle cx={cx + 2.4} cy="91.6" r="2.5" fill="#fff" /><circle cx={cx - 2} cy="98.4" r="1.2" fill="#fff" opacity=".85" /><path d={`M${cx - 7.5} 88.5 Q${cx} 84 ${cx + 7.5} 88.5`} stroke="#2B1B3A" strokeWidth="2.2" fill="none" strokeLinecap="round" /></g>);
  const happy = (cx) => <path key={cx} d={`M${cx - 6} 96 Q${cx} 88 ${cx + 6} 96`} stroke="#2B1B3A" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
  const sleepy = (cx) => <path key={cx} d={`M${cx - 6} 93 Q${cx} 99 ${cx + 6} 93`} stroke="#2B1B3A" strokeWidth="3" fill="none" strokeLinecap="round" />;
  if (mood === "happy" || mood === "celebrate") return <>{happy(82)}{happy(118)}</>;
  if (mood === "wink") return <>{open(82)}{happy(118)}</>;
  if (mood === "calm") return <>{sleepy(82)}{sleepy(118)}</>;
  if (mood === "think") return <><g transform="translate(2 -3)">{open(82)}{open(118)}</g></>;
  return <>{open(82)}{open(118)}</>;
}
function Mouth({ mood }) {
  if (mood === "celebrate") return <g><path d="M88 108 Q100 126 112 108 Z" fill="#7A2840" stroke="#7A2840" strokeWidth="2" strokeLinejoin="round" /><path d="M93 118 Q100 123 107 118 Q100 114 93 118z" fill="#F28DA6" /></g>;
  if (mood === "happy" || mood === "wave" || mood === "wink") return <path d="M89 108 Q100 120 111 108" stroke="#8A3350" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
  if (mood === "think") return <ellipse cx="102" cy="112" rx="3.6" ry="3" fill="#8A3350" />;
  return <path d="M92 109 Q100 115 108 109" stroke="#8A3350" strokeWidth="3" fill="none" strokeLinecap="round" />;
}
function Brows({ mood }) {
  const y = mood === "think" ? 78 : 80;
  return <><path d={`M74 ${y} Q82 ${y - 4} 90 ${y}`} stroke="#2B1B3A" strokeOpacity=".55" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d={`M110 ${mood === "think" ? 74 : y} Q118 ${(mood === "think" ? 74 : y) - 4} 126 ${mood === "think" ? 76 : y}`} stroke="#2B1B3A" strokeOpacity=".55" strokeWidth="2.4" fill="none" strokeLinecap="round" /></>;
}

export default function ClinicMate({ look, mood = "wave", size = 140, className = "", style }) {
  const L = look || LOOKS[0], id = useId().replace(/:/g, "");
  const up = mood === "celebrate";
  return (
    <svg viewBox="0 0 200 230" width={size} height={size * 1.15} className={`mate ${className}`} style={style} role="img" aria-label="Friendly clinic character">
      <defs>
        <radialGradient id={`sk${id}`} cx="38%" cy="30%" r="80%"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".35" stopColor={L.skin} /><stop offset="1" stopColor={L.skinDark} /></radialGradient>
        <linearGradient id={`tp${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={L.top} /><stop offset="1" stopColor={L.top} stopOpacity=".78" /></linearGradient>
        <linearGradient id={`hr${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={L.hair} /><stop offset="1" stopColor={L.hair} stopOpacity=".86" /></linearGradient>
        <linearGradient id={`ct${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#E9E2F7" /></linearGradient>
        <filter id={`bl${id}`}><feGaussianBlur stdDeviation="3" /></filter>
        <filter id={`bl2${id}`}><feGaussianBlur stdDeviation="1.6" /></filter>
        <filter id={`drop${id}`} x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#4B2FA0" floodOpacity=".28" /></filter>
        <radialGradient id={`hd${id}`} cx="36%" cy="28%" r="85%"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset=".28" stopColor={L.skin} /><stop offset=".8" stopColor={L.skinDark} /><stop offset="1" stopColor={L.skinDark} stopOpacity=".92" /></radialGradient>
        <radialGradient id={`hl${id}`} cx="34%" cy="18%" r="75%"><stop offset="0" stopColor="#fff" stopOpacity=".42" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" /></radialGradient>
        <linearGradient id={`sh${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#2B1B6A" stopOpacity=".2" /></linearGradient>
        <radialGradient id="iris" cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#B7794A" /><stop offset=".6" stopColor="#6B3B22" /><stop offset="1" stopColor="#3A1D10" /></radialGradient>
      </defs>
      <g filter={`url(#drop${id})`}>
      <ellipse cx="100" cy="222" rx="62" ry="7" fill="#7C5CD6" opacity=".16" filter={`url(#bl${id})`} />

      {/* hair behind */}
      {L.style === "long" && <path d="M52 92 Q48 160 66 176 L134 176 Q152 160 148 92 Z" fill={`url(#hr${id})`} />}
      {L.style === "bun" && <circle cx="100" cy="30" r="19" fill={`url(#hr${id})`} />}

      {/* body */}
      <path d="M36 224 Q36 160 100 154 Q164 160 164 224 Z" fill={`url(#tp${id})`} /><path d="M36 224 Q36 160 100 154 Q164 160 164 224 Z" fill={`url(#sh${id})`} />
      {L.coat && <><path d="M36 224 Q38 168 78 158 L100 196 L122 158 Q162 168 164 224 Z" fill={`url(#ct${id})`} /><path d="M78 158 L100 196 L100 224 M122 158 L100 196" stroke="#CFC3EA" strokeWidth="2" fill="none" /></>}
      {L.coat && <path d="M84 164 Q76 196 92 206 Q108 214 112 196" stroke="#8C8FA3" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {L.coat && <circle cx="112" cy="196" r="5" fill="#B9BCCB" stroke="#8C8FA3" strokeWidth="2" />}
      <rect x="88" y="132" width="24" height="26" rx="10" fill={L.skinDark} /><ellipse cx="100" cy="144" rx="20" ry="8" fill="#000" opacity=".16" filter={`url(#bl${id})`} />

      {/* arm */}
      {mood === "wave" && <g className="mate-hand"><path d="M150 176 Q172 150 168 116" stroke={L.coat ? "#fff" : L.top} strokeWidth="19" fill="none" strokeLinecap="round" /><circle cx="168" cy="108" r="12" fill={`url(#sk${id})`} /></g>}
      {up && <><path d="M48 176 Q28 146 34 112" stroke={L.coat ? "#fff" : L.top} strokeWidth="19" fill="none" strokeLinecap="round" /><circle cx="35" cy="104" r="12" fill={`url(#sk${id})`} /><path d="M152 176 Q172 146 166 112" stroke={L.coat ? "#fff" : L.top} strokeWidth="19" fill="none" strokeLinecap="round" /><circle cx="165" cy="104" r="12" fill={`url(#sk${id})`} /></>}
      {mood === "think" && <><path d="M150 180 Q150 150 118 128" stroke={L.coat ? "#fff" : L.top} strokeWidth="19" fill="none" strokeLinecap="round" /><circle cx="114" cy="124" r="11" fill={`url(#sk${id})`} /></>}

      {/* head */}
      <ellipse cx="53" cy="98" rx="7" ry="10" fill={L.skinDark} /><ellipse cx="147" cy="98" rx="7" ry="10" fill={L.skinDark} />
      <ellipse cx="100" cy="94" rx="49" ry="51" fill={`url(#hd${id})`} /><ellipse cx="100" cy="94" rx="49" ry="51" fill={`url(#hl${id})`} />
      {/* hair front */}
      {L.style === "short" ? <path d="M52 88 Q48 40 100 40 Q152 40 148 88 Q140 66 118 62 Q100 70 78 62 Q60 68 52 88Z" fill={`url(#hr${id})`} /> : <path d="M52 92 Q46 42 100 42 Q154 42 148 92 Q138 62 106 58 Q76 62 52 92Z" fill={`url(#hr${id})`} />}
      <ellipse cx="100" cy="72" rx="40" ry="8" fill="#000" opacity=".10" filter={`url(#bl${id})`} />
      <ellipse cx="82" cy="52" rx="26" ry="7" fill="#fff" opacity=".28" filter={`url(#bl2${id})`} transform="rotate(-14 82 52)" />
      <path d="M66 62 Q76 48 98 46" stroke="#fff" strokeOpacity=".26" strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* face */}
      <Brows mood={mood} /><Eyes mood={mood} /><Mouth mood={mood} />
      <ellipse cx="66" cy="108" rx="11" ry="7" fill="#FF7FA0" opacity=".5" filter={`url(#bl2${id})`} /><ellipse cx="134" cy="108" rx="11" ry="7" fill="#FF7FA0" opacity=".5" filter={`url(#bl2${id})`} /><ellipse cx="98" cy="100" rx="2.4" ry="1.6" fill="#fff" opacity=".5" />
      <ellipse cx="100" cy="102" rx="3" ry="2.2" fill={L.skinDark} opacity=".6" />

      {/* extras */}
      {mood === "celebrate" && <g fill="none" strokeLinecap="round" strokeWidth="3"><path d="M20 60 l6 6 M26 60 l-6 6" stroke="#F5B942" /><path d="M176 48 l6 6 M182 48 l-6 6" stroke="#F08FB5" /><circle cx="14" cy="92" r="4" fill="#8D72E0" stroke="none" /><circle cx="186" cy="80" r="4" fill="#4FBF9B" stroke="none" /></g>}
      {mood === "think" && <g fill="#fff" stroke="#CFC3EA" strokeWidth="2"><circle cx="150" cy="52" r="4" /><circle cx="162" cy="40" r="6" /><circle cx="178" cy="24" r="9" /></g>}
      {mood === "calm" && <g fill="#F5B942"><path d="M158 44 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" /><circle cx="176" cy="70" r="3" /></g>}
      </g>
    </svg>
  );
}
