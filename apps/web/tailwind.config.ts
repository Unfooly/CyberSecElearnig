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
    },
  },
  plugins: [],
};

export default config;
