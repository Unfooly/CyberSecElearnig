import type { Config } from 'tailwindcss';

// Tokeny marki Unfooly - patrz docs/brand/BRAND.md. Te same wartości są
// zdublowane jako zmienne CSS w globals.css (dla stylów spoza Tailwinda).
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#131313',
        paper: '#F6F6F4',
        surface: '#FFFFFF',
        border: '#E6E6E2',
        muted: { DEFAULT: '#6F6F6B', 2: '#9A9A96' },
        accent: { DEFAULT: '#6C5CE7', hover: '#5B4BD6', soft: '#EEEBFF', ink: '#3F32B5' },
        success: { DEFAULT: '#1E9E6A', soft: '#E6F6EE' },
        warning: { DEFAULT: '#C77C0F', soft: '#FFF3DF' },
        danger: { DEFAULT: '#D9483B', soft: '#FDECEA' },
        // Zakreślacz (kolor funkcyjny, D-083): wyłącznie zakreślony wiersz-dowód w teczce sprawy - nie tło ani akcent UI.
        highlight: '#FFE066',
        // Rangi osiągnięć (D-111): tło rewersu karty, ciemne odcienie wstęg z grafik trofeów (biały tekst, kontrast >= 7:1).
        // rare (D-124): morski odcień wstęgi trofeów modułu 2 (kontrast z białym ~8.9:1).
        rank: { secret: '#7A2150', legendary: '#7A5A14', milestone: '#261D7A', rare: '#0E5257' },
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        // Wyłącznie numer sprawy i treść dokumentów w teczce (BRAND.md) - nie do nagłówków ani UI.
        typewriter: ['var(--font-typewriter)', '"Courier Prime"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '16px', btn: '10px' },
      boxShadow: {
        card: '0 1px 2px rgba(19,19,19,.04), 0 8px 24px -16px rgba(19,19,19,.18)',
      },
      // Ruch (BRAND.md, „Ruch”; D-090): czasy i krzywe - te same wartości w src/lib/motion.ts (animacje z JS) i globals.css (--motion-*).
      // Animować wyłącznie transform/opacity; każda animacja pod motion-safe albo z obsługą prefers-reduced-motion.
      transitionDuration: { fast: '120ms', base: '200ms', slow: '400ms' },
      transitionTimingFunction: { 'out-soft': 'cubic-bezier(.2,.8,.2,1)', 'in-out-soft': 'cubic-bezier(.65,0,.35,1)' },
      keyframes: {
        'digit-roll': { from: { opacity: '0', transform: 'translateY(60%)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'highlight-in': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        'check-draw': { from: { strokeDashoffset: '24' }, to: { strokeDashoffset: '0' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'overlay-in': { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'overlay-out': { from: { opacity: '1', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(.96)' } },
        'badge-pop': { '0%': { opacity: '0', transform: 'scale(.6)' }, '70%': { opacity: '1', transform: 'scale(1.08)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        'digit-roll': 'digit-roll 200ms cubic-bezier(.2,.8,.2,1) both',
        'highlight-in': 'highlight-in 350ms cubic-bezier(.2,.8,.2,1) both',
        'check-draw': 'check-draw 300ms cubic-bezier(.2,.8,.2,1) both',
        'rise-in': 'rise-in 400ms cubic-bezier(.2,.8,.2,1) both',
        'overlay-in': 'overlay-in 180ms cubic-bezier(.2,.8,.2,1) both',
        'overlay-out': 'overlay-out 140ms cubic-bezier(.65,0,.35,1) both',
        'badge-pop': 'badge-pop 400ms cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
