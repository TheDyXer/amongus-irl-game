// The shared crewmate artwork from design/mockups (viewBox 100 × 124), path for path.
const OUTLINE = '#0b0e13';
const BONE_WHITE = '#f4efe4';
const PACK = 'M6 44 Q6 38 12 38 L24 38 L24 90 L12 90 Q6 90 6 84 Z';
const BODY =
  'M24 112 L24 50 C24 22 42 8 58 8 C76 8 92 22 92 48 L92 112 Q92 118 86 118 L67 118 Q61 118 61 112 L61 100 L55 100 L55 112 Q55 118 49 118 L30 118 Q24 118 24 112 Z';
const SHADE = 'M24 74 Q32 100 55 100 L55 112 Q55 118 49 118 L30 118 Q24 118 24 112 Z';
const GHOST =
  'M24 50 C24 22 42 8 58 8 C76 8 92 22 92 48 L92 104 Q84 118 76 106 Q68 94 60 106 Q52 118 44 106 Q36 94 28 106 L24 110 Z';
const HALF =
  'M24 72 L34 64 L44 74 L55 64 L66 74 L78 64 L92 72 L92 112 Q92 118 86 118 L67 118 Q61 118 61 112 L61 100 L55 100 L55 112 Q55 118 49 118 L30 118 Q24 118 24 112 Z';
const BONE = 'M58 72 L58 42';

export interface CrewmateProps {
  color: string;
  shadow: string;
  /** Width in px; the height follows the 100 × 124 artwork. */
  size?: number;
  /** Wavy-bottomed, see-through ghost. */
  ghost?: boolean;
  /** The half body with a bone (wins over `ghost`). */
  dead?: boolean;
  /** Accessible name; without it the drawing is decorative. */
  title?: string;
  className?: string;
}

export function Crewmate({ color, shadow, size = 48, ghost = false, dead = false, title, className }: CrewmateProps) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  return (
    <svg
      viewBox="0 0 100 124"
      width={size}
      height={Math.round(size * 1.24)}
      overflow="visible"
      opacity={ghost && !dead ? 0.6 : undefined}
      className={className}
      {...a11y}
    >
      {dead ? (
        <>
          <path d={BONE} stroke={OUTLINE} strokeWidth={16} strokeLinecap="round" fill="none" />
          <path d={BONE} stroke={BONE_WHITE} strokeWidth={8} strokeLinecap="round" fill="none" />
          <circle cx={52} cy={38} r={8} fill={BONE_WHITE} stroke={OUTLINE} strokeWidth={4} />
          <circle cx={64} cy={38} r={8} fill={BONE_WHITE} stroke={OUTLINE} strokeWidth={4} />
          <path d={HALF} fill={color} />
          <path d={SHADE} fill={shadow} />
          <path d={HALF} fill="none" stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d={PACK} fill={color} stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
          <path d={ghost ? GHOST : BODY} fill={color} />
          {!ghost && <path d={SHADE} fill={shadow} />}
          <path d={ghost ? GHOST : BODY} fill="none" stroke={OUTLINE} strokeWidth={6} strokeLinejoin="round" />
          <rect x={50} y={24} width={48} height={28} rx={14} fill="#95CADC" stroke={OUTLINE} strokeWidth={6} />
          <rect x={70} y={29} width={18} height={7} rx={3.5} fill="#ffffff" opacity={0.85} />
        </>
      )}
    </svg>
  );
}
