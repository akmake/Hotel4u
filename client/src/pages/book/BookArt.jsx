// Illustrations for the booking site when the hotel has not uploaded photos yet: the lake at dusk
// for the hero, and an arched window onto the room's view for each room type. Pure SVG, no assets.
import { useId } from 'react';

const SKIES = {
  dawn: ['#2b3a4a', '#7d8fa0', '#e8c9a8', '#f3dcc0'],
  day: ['#6f93a8', '#a9c3cf', '#e6ddcc', '#f1e9da'],
  sunset: ['#2d2b3d', '#8a5a5c', '#d98f63', '#f0c08a'],
  dusk: ['#101c25', '#2a3d4c', '#9a7a6c', '#d9a77f'],
};
const WALLS = [
  ['#efe6d6', '#e2d5c0'],
  ['#e9ddc9', '#d8c7ab'],
  ['#ece3d3', '#ddd0bb'],
  ['#e4d7c3', '#cdb99b'],
];

export function HeroArt() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="bk-hero-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1418" />
          <stop offset=".42" stopColor="#1c2f37" />
          <stop offset=".7" stopColor="#6b5a55" />
          <stop offset=".86" stopColor="#c48f6a" />
          <stop offset="1" stopColor="#e8bb8a" />
        </linearGradient>
        <linearGradient id={`${id}lake`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c99a74" stopOpacity=".55" />
          <stop offset=".25" stopColor="#3b4a4f" />
          <stop offset="1" stopColor="#0c1517" />
        </linearGradient>
        <radialGradient id={`${id}sun`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fbe3bf" />
          <stop offset=".45" stopColor="#f2c48f" stopOpacity=".55" />
          <stop offset="1" stopColor="#f2c48f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1418" stopOpacity=".55" />
          <stop offset=".35" stopColor="#0b1418" stopOpacity="0" />
          <stop offset=".7" stopColor="#0b1418" stopOpacity="0" />
          <stop offset="1" stopColor="#0b1418" stopOpacity=".75" />
        </linearGradient>
        <filter id={`${id}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .05 0" />
        </filter>
      </defs>
      <rect width="1600" height="900" fill={`url(#${id}sky)`} />
      {[[180, 120], [420, 70], [760, 150], [1040, 90], [1310, 160], [1480, 60], [600, 40], [250, 230], [1180, 220]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 ? 1 : 1.6} fill="#f5e9d6" opacity={0.35 + (i % 4) * 0.1} />
      ))}
      <circle cx="980" cy="560" r="230" fill={`url(#${id}sun)`} />
      <circle cx="980" cy="575" r="34" fill="#f8dcb2" opacity=".9" />
      {/* Golan ridges */}
      <path d="M0 560 C 120 520 220 540 330 515 C 460 485 560 520 690 500 C 820 480 900 505 1010 492 C 1140 476 1250 512 1380 488 C 1480 470 1550 486 1600 480 L1600 600 L0 600 Z" fill="#4a3f45" opacity=".75" />
      <path d="M0 585 C 160 556 260 575 400 560 C 560 542 650 568 800 556 C 940 545 1060 566 1200 552 C 1330 540 1460 562 1600 548 L1600 610 L0 610 Z" fill="#2e2a31" />
      <rect y="598" width="1600" height="302" fill={`url(#${id}lake)`} />
      {/* sun path on the water */}
      {Array.from({ length: 16 }).map((_, i) => {
        const y = 612 + i * 17;
        const w = 30 + i * 9;
        return <rect key={i} x={980 - w / 2 + ((i * 37) % 23) - 11} y={y} width={w} height={i < 5 ? 2.2 : 1.6} rx="1" fill="#f6d2a2" opacity={0.65 - i * 0.035} />;
      })}
      {Array.from({ length: 22 }).map((_, i) => (
        <rect key={`s${i}`} x={(i * 173) % 1600} y={640 + ((i * 53) % 230)} width={40 + (i % 5) * 18} height="1.2" fill="#e9d2b4" opacity=".12" />
      ))}
      {/* near shore + palms */}
      <path d="M0 830 C 220 800 380 812 560 826 C 700 836 820 818 960 828 L960 900 L0 900 Z" fill="#081012" />
      <g fill="#081012">
        <path d="M200 832 C 204 760 212 700 222 640 L228 640 C 220 700 214 760 212 832 Z" />
        <path d="M225 640 c-40 -6 -78 6 -104 28 c34 -12 66 -16 100 -10 Z M225 640 c34 -14 76 -12 108 6 c-36 -6 -70 -4 -104 4 Z M225 640 c-20 -26 -52 -40 -86 -42 c28 10 52 24 80 46 Z M225 640 c16 -28 44 -46 78 -52 c-24 14 -48 32 -72 56 Z M225 640 c-6 -30 -2 -56 10 -78 c-2 26 -2 50 -6 78 Z" />
        <path d="M330 836 C 333 786 338 742 346 700 L351 700 C 345 742 340 786 340 836 Z" />
        <path d="M349 700 c-30 -5 -58 4 -78 20 c26 -9 50 -12 76 -8 Z M349 700 c26 -10 56 -9 80 4 c-27 -5 -52 -3 -78 3 Z M349 700 c-15 -20 -38 -30 -64 -32 c21 8 39 18 60 35 Z M349 700 c12 -21 33 -35 58 -39 c-18 10 -36 24 -54 42 Z" />
      </g>
      <rect width="1600" height="900" fill={`url(#${id}fade)`} />
      <rect width="1600" height="900" filter={`url(#${id}grain)`} />
    </svg>
  );
}

// A room seen from inside: wall, an arched window onto its view, the bed and a lamp.
export function RoomArt({ view = 'garden', index = 0, label }) {
  const id = useId().replace(/:/g, '');
  const tod = ['dawn', 'sunset', 'day', 'dusk'][index % 4];
  const sky = SKIES[tod];
  const wall = WALLS[index % WALLS.length];
  const isSea = view === 'sea' || view === 'pool';
  const isCity = view === 'city' || view === 'courtyard' || view === 'interior';
  return (
    <svg className="bk-room-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={label || 'איור החדר'}>
      <defs>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={wall[0]} /><stop offset="1" stopColor={wall[1]} /></linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} /><stop offset=".45" stopColor={sky[1]} /><stop offset=".8" stopColor={sky[2]} /><stop offset="1" stopColor={sky[3]} />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky[2]} stopOpacity=".7" /><stop offset="1" stopColor={sky[0]} /></linearGradient>
        <linearGradient id={`${id}light`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff6e6" stopOpacity=".55" /><stop offset="1" stopColor="#fff6e6" stopOpacity="0" /></linearGradient>
        <clipPath id={`${id}win`}><path d="M210 222 V96 a62 62 0 0 1 124 0 V222 Z" /></clipPath>
      </defs>
      <rect width="400" height="300" fill={`url(#${id}w)`} />
      <g clipPath={`url(#${id}win)`}>
        <rect x="200" y="20" width="150" height="210" fill={`url(#${id}s)`} />
        <circle cx={tod === 'day' ? 300 : 258} cy={tod === 'day' ? 92 : 168} r="11" fill="#fbe7c6" opacity=".9" />
        {isSea && (
          <>
            <path d="M200 176 C 230 166 250 172 272 164 C 296 156 318 166 350 160 L350 186 L200 186 Z" fill={sky[0]} opacity=".55" />
            <rect x="200" y="184" width="150" height="46" fill={`url(#${id}l)`} />
            {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={244 + (i % 2) * 10} y={190 + i * 7} width={30 - i * 3} height="1.4" fill="#fbe7c6" opacity={0.6 - i * 0.1} />)}
          </>
        )}
        {!isSea && !isCity && (
          <>
            <path d="M200 170 C 236 150 270 162 300 148 C 320 140 338 150 350 146 L350 230 L200 230 Z" fill="#7f8a6c" opacity=".8" />
            <path d="M200 190 C 240 176 276 186 350 176 L350 230 L200 230 Z" fill="#5d6a4f" />
            <path d="M232 192 c-1 -26 4 -46 8 -58 c4 12 9 32 8 58 Z M318 186 c-1 -30 5 -52 9 -66 c4 14 10 36 9 66 Z" fill="#3d4a36" />
            <ellipse cx="282" cy="190" rx="18" ry="11" fill="#4c5a40" />
          </>
        )}
        {isCity && (
          <path d="M200 230 V186 h18 v-14 h16 v20 h14 v-30 h20 v26 h18 v-16 h22 v20 h14 v-12 h28 V230 Z" fill={sky[0]} opacity=".75" />
        )}
      </g>
      <path d="M210 222 V96 a62 62 0 0 1 124 0 V222" fill="none" stroke="#a8834f" strokeWidth="2.4" />
      <path d="M272 34 V222 M210 140 H334" stroke="#a8834f" strokeWidth="1.2" opacity=".75" />
      <path d="M200 226 H344" stroke="#9c8463" strokeWidth="4" strokeLinecap="round" />
      <path d="M150 300 L210 222 H334 L380 300 Z" fill={`url(#${id}light)`} opacity=".6" />
      {/* floor */}
      <rect y="250" width="400" height="50" fill="#cdbb9f" opacity=".55" />
      {/* bed */}
      <rect x="26" y="168" width="150" height="70" rx="6" fill="#8e7a62" opacity=".9" />
      <rect x="20" y="212" width="196" height="46" rx="5" fill="#f7f1e6" />
      <rect x="20" y="236" width="196" height="22" rx="4" fill="#e6dccb" />
      <rect x="34" y="194" width="58" height="24" rx="8" fill="#fbf7f0" />
      <rect x="100" y="194" width="58" height="24" rx="8" fill="#fbf7f0" />
      <rect x="120" y="214" width="96" height="28" rx="4" fill="#a8834f" opacity=".85" />
      {/* lamp */}
      <path d="M186 40 V126" stroke="#6f5d47" strokeWidth="1.2" />
      <path d="M172 126 h28 l-5 18 h-18 Z" fill="#e9d6b4" />
      <circle cx="186" cy="150" r="22" fill="#fff1d6" opacity=".25" />
    </svg>
  );
}
