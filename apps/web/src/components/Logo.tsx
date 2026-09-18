// Logotyp Unfooly jako inline SVG (docs/brand/BRAND.md) - własne liternictwo,
// nie font. Kropka zawsze w kolorze akcentu, poza wariantem mono, który
// dziedziczy kolor tekstu przez currentColor.
export type LogoVariant = 'dark' | 'white' | 'mono';

const COLORS: Record<LogoVariant, { letters: string; dot: string }> = {
  dark: { letters: '#131313', dot: '#6C5CE7' },
  white: { letters: '#F6F6F4', dot: '#6C5CE7' },
  mono: { letters: 'currentColor', dot: 'currentColor' },
};

const LETTER_PATHS = [
  { transform: 'translate(0 0)', d: 'M13 113 V150 A37 37 0 0 0 87 150 V113 M87 150 V187' },
  { transform: 'translate(122 0)', d: 'M13 113 V187 M13 150 A37 37 0 0 1 87 150 V187' },
  { transform: 'translate(257 0)', d: 'M0 100 H54 M21 187 V94 A34 34 0 0 1 55 60' },
  { transform: 'translate(591 0)', d: 'M13 60 V187' },
  { transform: 'translate(639 0)', d: 'M87 113 L45 232 M13 113 L56 200' },
];

export default function Logo({ variant = 'dark', height = 26, className }: { variant?: LogoVariant; height?: number; className?: string }) {
  const { letters, dot } = COLORS[variant];
  const stroke = { fill: 'none', stroke: letters, strokeWidth: 26, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  return (
    <svg
      viewBox="0 0 855 278"
      style={{ height, width: 'auto', display: 'block' }}
      className={className}
      role="img"
      aria-label="Unfooly"
    >
      <g transform="translate(40 -7)">
        {LETTER_PATHS.map((path) => (
          <path key={path.transform} transform={path.transform} d={path.d} {...stroke} />
        ))}
        <circle cx="397" cy="150" r="37" fill="none" stroke={letters} strokeWidth="26" />
        <circle cx="519" cy="150" r="37" fill="none" stroke={letters} strokeWidth="26" />
        <circle cx="779" cy="182" r="18" fill={dot} />
      </g>
    </svg>
  );
}
