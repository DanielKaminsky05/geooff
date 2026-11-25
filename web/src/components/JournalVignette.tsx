/**
 * A small hand-drawn landscape vignette for the Field Journal masthead — the
 * illustrated "scene" pasted into the journal, echoing Farflung's banner art.
 * Layered mountain ridges in muted sage/blue washes, a low ochre sun, a few
 * pines and a dashed red trail winding toward the peaks. Pure inline SVG (no
 * assets), aria-hidden and decorative.
 */
export default function JournalVignette() {
  return (
    <svg
      viewBox="0 0 260 96"
      aria-hidden="true"
      focusable="false"
      className="block h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="jv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c6d2cc" />
          <stop offset="62%" stopColor="#dcd8c3" />
          <stop offset="100%" stopColor="#ecdfc1" />
        </linearGradient>
        <radialGradient id="jv-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e6ab54" />
          <stop offset="100%" stopColor="#c98a32" />
        </radialGradient>
        <clipPath id="jv-clip">
          <rect x="0" y="0" width="260" height="96" rx="2" />
        </clipPath>
      </defs>

      <g clipPath="url(#jv-clip)">
        {/* Sky wash */}
        <rect x="0" y="0" width="260" height="96" fill="url(#jv-sky)" />

        {/* Low sun with a soft halo and a few rays */}
        <circle cx="196" cy="50" r="30" fill="#e8c585" opacity="0.28" />
        <circle cx="196" cy="50" r="11" fill="url(#jv-sun)" />
        <g stroke="#cf9a44" strokeWidth="1.1" strokeLinecap="round" opacity="0.65">
          <line x1="196" y1="31" x2="196" y2="25" />
          <line x1="213" y1="40" x2="219" y2="35" />
          <line x1="179" y1="40" x2="173" y2="35" />
          <line x1="216" y1="54" x2="223" y2="54" />
          <line x1="176" y1="54" x2="169" y2="54" />
        </g>

        {/* Birds */}
        <g stroke="#5a4a34" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7">
          <path d="M60 24 q4 -4 8 0 q4 -4 8 0" />
          <path d="M84 30 q3 -3 6 0 q3 -3 6 0" />
        </g>

        {/* Distant ridge — pale blue-grey */}
        <path
          d="M0 62 L34 48 L70 60 L104 44 L150 62 L196 46 L234 60 L260 50 L260 96 L0 96 Z"
          fill="#9fb0a9"
          opacity="0.75"
        />
        {/* Mid ridge — sage, with snow caps */}
        <path
          d="M0 74 L40 54 L78 72 L120 50 L168 72 L210 56 L260 74 L260 96 L0 96 Z"
          fill="#6f8a63"
        />
        <g fill="#eef0e6" opacity="0.85">
          <path d="M120 50 L128 60 L112 60 Z" />
          <path d="M40 54 L47 63 L33 63 Z" />
          <path d="M210 56 L217 65 L203 65 Z" />
        </g>
        {/* Foreground hill — deep olive */}
        <path
          d="M0 86 L46 74 L96 84 L150 72 L210 84 L260 76 L260 96 L0 96 Z"
          fill="#415a37"
        />

        {/* Pines on the foreground hill */}
        <g fill="#2f4a2c">
          <g transform="translate(70 78)">
            <path d="M0 -10 L4 0 L-4 0 Z" />
            <path d="M0 -6 L5 4 L-5 4 Z" />
            <rect x="-1" y="4" width="2" height="3" fill="#4a3826" />
          </g>
          <g transform="translate(182 80)">
            <path d="M0 -8 L3.4 0 L-3.4 0 Z" />
            <path d="M0 -4.5 L4.2 3.4 L-4.2 3.4 Z" />
            <rect x="-0.9" y="3.4" width="1.8" height="2.6" fill="#4a3826" />
          </g>
        </g>

        {/* Dashed red trail winding toward the peaks */}
        <path
          d="M118 96 C 110 86, 134 80, 126 70 C 120 62, 138 58, 132 50"
          fill="none"
          stroke="#b5362b"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 3"
          opacity="0.85"
        />
      </g>

      {/* Thin ink keyline framing the scene */}
      <rect
        x="0.6"
        y="0.6"
        width="258.8"
        height="94.8"
        rx="2"
        fill="none"
        stroke="#6b5536"
        strokeWidth="1.1"
        opacity="0.55"
      />
    </svg>
  );
}
