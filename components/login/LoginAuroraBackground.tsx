'use client';

/**
 * LoginAuroraBackground — a premium, abstract ambient backdrop for the auth pages.
 *
 * A cleaner successor to the literal corridor-map background: a deep
 * indigo → slate → teal gradient, slow-drifting aurora orbs, bankex-style
 * flowing light streams that travel left→right (evoking money corridors
 * without a literal map), a fine parallax dot grid, a slow diagonal sheen,
 * and a vignette that grounds the sign-in card.
 *
 * Stays on Splash's palette (slate · teal · indigo · orange · mint). All motion
 * is transform / opacity / stroke-dashoffset based, and collapses to a static
 * gradient under prefers-reduced-motion.
 */

// Smooth horizontal wave across the canvas, alternating crest/trough.
function streamPath(y: number, amp: number) {
  const startX = -80;
  const endX = 1520;
  const span = endX - startX;
  const segments = 4;
  const seg = span / segments;
  let d = `M ${startX} ${y}`;
  for (let i = 0; i < segments; i += 1) {
    const cx = startX + seg * i + seg * 0.5;
    const x2 = startX + seg * (i + 1);
    const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q ${cx} ${y + dir * amp} ${x2} ${y}`;
  }
  return d;
}

const STREAMS = [
  { y: 150, amp: 54, accent: '#5C9EAD', dur: 9,  delay: 0,   width: 2 },
  { y: 300, amp: 78, accent: '#E39774', dur: 11, delay: -2,  width: 2 },
  { y: 452, amp: 46, accent: '#6FB4A0', dur: 8,  delay: -4,  width: 1.6 },
  { y: 600, amp: 86, accent: '#5C9EAD', dur: 12, delay: -1,  width: 2 },
  { y: 742, amp: 58, accent: '#8FA6D8', dur: 10, delay: -5,  width: 1.6 },
  { y: 880, amp: 70, accent: '#E39774', dur: 13, delay: -3,  width: 2 },
] as const;

// Deterministic particle field (no Math.random → no hydration mismatch).
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  cx: (i * 97 + 40) % 1440,
  cy: 80 + ((i * 61) % 800),
  r: i % 6 === 0 ? 1.9 : 1.1,
  dur: 3 + ((i * 7) % 5),
  delay: (i % 7) * 0.45,
}));

export default function LoginAuroraBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Base gradient — deep indigo depth → slate → teal shallows */}
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#152138_0%,#1b3a48_46%,#234e5e_78%,#2c5f6f_100%)]" />

      {/* Drifting aurora orbs (reuse the global splashOrb keyframes) */}
      <div
        className="splash-orb"
        style={{
          width: 'min(68vw, 760px)', height: 'min(68vw, 760px)', top: '-20%', left: '-10%',
          background: 'radial-gradient(circle, #5C9EAD 0%, transparent 66%)',
          opacity: 0.3, animation: 'splashOrbA 22s ease-in-out infinite',
        }}
      />
      <div
        className="splash-orb"
        style={{
          width: 'min(58vw, 640px)', height: 'min(58vw, 640px)', top: '34%', left: '66%',
          background: 'radial-gradient(circle, #E39774 0%, transparent 66%)',
          opacity: 0.22, animation: 'splashOrbB 27s ease-in-out infinite', animationDelay: '-6s',
        }}
      />
      <div
        className="splash-orb"
        style={{
          width: 'min(50vw, 560px)', height: 'min(50vw, 560px)', top: '56%', left: '8%',
          background: 'radial-gradient(circle, #2B3A67 0%, transparent 68%)',
          opacity: 0.42, animation: 'splashOrbC 31s ease-in-out infinite', animationDelay: '-11s',
        }}
      />
      <div
        className="splash-orb"
        style={{
          width: 'min(40vw, 460px)', height: 'min(40vw, 460px)', top: '4%', left: '52%',
          background: 'radial-gradient(circle, #6FB4A0 0%, transparent 70%)',
          opacity: 0.16, animation: 'splashOrbA 26s ease-in-out infinite', animationDelay: '-14s',
        }}
      />

      {/* Parallax dot grid + slow diagonal sheen (global classes) */}
      <div className="splash-grid" style={{ opacity: 0.14 }} />
      <div className="splash-sheen" style={{ left: '-25%', opacity: 0.5 }} />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 960"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="loginTopGlow" cx="0.42" cy="0.18" r="0.7">
            <stop offset="0%" stopColor="rgba(246,224,201,0.35)" />
            <stop offset="55%" stopColor="rgba(246,224,201,0)" />
          </radialGradient>
          <linearGradient id="loginVignette" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(12,24,38,0.5)" />
            <stop offset="32%" stopColor="rgba(12,24,38,0)" />
            <stop offset="74%" stopColor="rgba(10,20,30,0)" />
            <stop offset="100%" stopColor="rgba(8,16,26,0.62)" />
          </linearGradient>
        </defs>

        {/* Soft overhead glow */}
        <ellipse cx="600" cy="170" rx="980" ry="320" fill="url(#loginTopGlow)" />

        {/* Flowing light streams — faint base strand + travelling light segment */}
        <g className="login-streams">
          {STREAMS.map((s) => {
            const d = streamPath(s.y, s.amp);
            return (
              <g key={s.y}>
                <path d={d} fill="none" stroke="rgba(246,240,237,0.10)" strokeWidth="1" />
                <path
                  d={d}
                  fill="none"
                  stroke={s.accent}
                  strokeWidth={s.width}
                  strokeLinecap="round"
                  pathLength={1000}
                  strokeDasharray="130 870"
                  style={{
                    animation: `loginStreamFlow ${s.dur}s linear infinite`,
                    animationDelay: `${s.delay}s`,
                    opacity: 0.85,
                  }}
                />
              </g>
            );
          })}
        </g>

        {/* Drifting particles */}
        <g>
          {PARTICLES.map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill="rgba(246,240,237,0.7)"
              style={{
                animation: `loginTwinkle ${p.dur}s ease-in-out infinite`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </g>

        {/* Depth vignette to frame the sign-in card */}
        <rect x="0" y="0" width="1440" height="960" fill="url(#loginVignette)" />
      </svg>

      <style>{`
        @keyframes loginStreamFlow { to { stroke-dashoffset: -1000; } }
        @keyframes loginTwinkle {
          0%, 100% { opacity: 0.08; }
          50%      { opacity: 0.75; }
        }
        .login-streams { animation: loginStreamsDrift 18s ease-in-out infinite; }
        @keyframes loginStreamsDrift {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-10px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="loginStreamFlow"],
          [style*="loginTwinkle"],
          .login-streams { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
