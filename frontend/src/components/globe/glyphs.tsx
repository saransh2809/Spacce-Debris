/**
 * KAKSHA -- DOM glyphs matching the 3D sprites.
 *
 * The legend is only useful if its marks are the marks actually on the globe.
 * These SVGs are drawn to the same silhouettes as the canvas sprites in
 * sprites.ts, so "that shape means rocket body" transfers directly from the
 * key to the scene. They take `currentColor`, so a caller sets the class
 * colour once on the wrapper.
 */

interface GlyphProps {
  size?: number;
  color?: string;
  title?: string;
}

function frame(size: number, color: string | undefined, title: string | undefined) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    style: { color, display: "block" as const, flexShrink: 0 },
    role: title ? ("img" as const) : ("presentation" as const),
    "aria-label": title,
  };
}

/** Bus with two solar wings, a dish and an antenna. */
export function SatelliteGlyph({ size = 14, color, title }: GlyphProps) {
  return (
    <svg {...frame(size, color, title)}>
      <g transform="rotate(-20 24 24)">
        <rect x="1" y="18.5" width="13" height="9" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="1" y="18.5" width="13" height="1.5" fill="currentColor" />
        <rect x="7" y="18.5" width="1" height="9" fill="currentColor" opacity="0.3" />
        <rect x="34" y="18.5" width="13" height="9" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="34" y="18.5" width="13" height="1.5" fill="currentColor" />
        <rect x="40" y="18.5" width="1" height="9" fill="currentColor" opacity="0.3" />
        <rect x="14" y="21.8" width="5" height="2.2" fill="currentColor" opacity="0.9" />
        <rect x="29" y="21.8" width="5" height="2.2" fill="currentColor" opacity="0.9" />
        <rect x="18.5" y="16" width="11" height="14" rx="1.4" fill="currentColor" />
        <rect x="18.5" y="21.5" width="11" height="1.3" fill="currentColor" opacity="0.4" />
        <ellipse
          cx="15"
          cy="32.5"
          rx="4.6"
          ry="3.4"
          transform="rotate(-28 15 32.5)"
          fill="currentColor"
          opacity="0.9"
        />
        <path d="M18 31 L21.5 28.3" stroke="currentColor" strokeWidth="1.3" />
        <path d="M26 16 L28 9.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="28.2" cy="8.7" r="1.5" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Long truss with four wing pairs. */
export function StationGlyph({ size = 14, color, title }: GlyphProps) {
  return (
    <svg {...frame(size, color, title)}>
      <g transform="rotate(-18 24 24)">
        <rect x="3" y="22.6" width="42" height="2.8" fill="currentColor" />
        {[5, 14, 28, 37].map((x) => (
          <g key={x}>
            <rect x={x} y="13" width="7" height="8" rx="0.6" fill="currentColor" opacity="0.72" />
            <rect x={x} y="13" width="7" height="1" fill="currentColor" />
            <rect x={x} y="27" width="7" height="8" rx="0.6" fill="currentColor" opacity="0.72" />
            <rect x={x} y="27" width="7" height="1" fill="currentColor" />
          </g>
        ))}
        <rect x="20" y="19.5" width="9" height="9" rx="1.2" fill="currentColor" />
        <rect x="22.5" y="15" width="4" height="18" rx="1" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Spent upper stage: capsule body with an engine bell. */
export function RocketGlyph({ size = 14, color, title }: GlyphProps) {
  return (
    <svg {...frame(size, color, title)}>
      <g transform="rotate(-36 24 24)">
        <rect x="18" y="8" width="12" height="26" rx="5" fill="currentColor" />
        <rect x="18" y="17" width="12" height="1.6" fill="currentColor" opacity="0.4" />
        <rect x="18" y="26" width="12" height="1.6" fill="currentColor" opacity="0.4" />
        <path d="M19.5 34 L28.5 34 L31 41 L17 41 Z" fill="currentColor" opacity="0.85" />
      </g>
    </svg>
  );
}

/** Irregular tumbled fragment. */
export function DebrisGlyph({ size = 14, color, title }: GlyphProps) {
  return (
    <svg {...frame(size, color, title)}>
      <path d="M13 18 L26 11 L37 22 L31 36 L17 34 Z" fill="currentColor" opacity="0.9" />
      <path d="M13 18 L26 11 L24 25 Z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** Plain mark, for anything that is a category rather than an object class. */
export function DotGlyph({ size = 14, color, title }: GlyphProps) {
  return (
    <svg {...frame(size, color, title)}>
      <circle cx="24" cy="24" r="9" fill="currentColor" />
      <circle cx="24" cy="24" r="15" fill="currentColor" opacity="0.22" />
    </svg>
  );
}

export type GlyphKind = "satellite" | "station" | "rocket" | "debris" | "dot";

export function Glyph({ kind, ...rest }: GlyphProps & { kind: GlyphKind }) {
  switch (kind) {
    case "satellite":
      return <SatelliteGlyph {...rest} />;
    case "station":
      return <StationGlyph {...rest} />;
    case "rocket":
      return <RocketGlyph {...rest} />;
    case "debris":
      return <DebrisGlyph {...rest} />;
    default:
      return <DotGlyph {...rest} />;
  }
}

/** Map a backend object type onto the glyph that represents it. */
export function glyphForType(type: string | undefined): GlyphKind {
  switch (type) {
    case "SPACE_STATION":
      return "station";
    case "ROCKET_BODY":
      return "rocket";
    case "DEBRIS":
      return "debris";
    case "ACTIVE_SATELLITE":
    case "INACTIVE_SATELLITE":
      return "satellite";
    default:
      return "dot";
  }
}
