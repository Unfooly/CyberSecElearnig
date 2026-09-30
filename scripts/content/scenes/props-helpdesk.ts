/**
 * Klocki modułu 2 „Głos z helpdesku”.
 * Zasada EN-ready: grafiki bez słów — tekst dokłada odtwarzacz (textLayer / sloty `slot-*`).
 * Dozwolone w grafice: cyfry i numery zamaskowane (12 3XX XX 41, 214), bo nie zależą od języka.
 */
import { P } from './palette.js';
import type { PropFn } from './types.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (x: number, y: number, s: unknown, size: number, o: { fill?: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; spacing?: number; opacity?: number } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill ?? P.ink}"${o.bold ? ' font-weight="bold"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}>${esc(s)}</text>`;
const bars = (x: number, y: number, widths: number[], gap = 18, h = 7, fill: string = P.grey) =>
  widths.map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`).join('');

/** Ikona słuchawki (środek w 0,0, rozmiar ~ s). */
const handset = (s: number, fill: string, rot = 0) =>
  `<g transform="rotate(${rot}) scale(${s / 100})"><path d="M-44 -30 c-10 10 -10 30 6 52 c16 22 36 34 52 30 l12 -16 c3 -5 1 -10 -4 -13 l-18 -10 c-5 -3 -10 -1 -13 3 l-5 7 c-10 -5 -22 -18 -27 -28 l7 -5 c4 -3 6 -8 3 -13 l-10 -18 c-3 -5 -8 -7 -13 -4 z" fill="${fill}" transform="translate(6 -6)"/></g>`;

/** Ikona narzędzia zdalnej pomocy: dwa monitory i strzałka (bez logotypu). */
const remoteIcon = (s: number) =>
  `<g transform="scale(${s / 100})"><rect x="-46" y="-34" width="52" height="38" rx="5" fill="${P.purple}"/><rect x="-40" y="-28" width="40" height="26" rx="2" fill="${P.sky}"/>` +
  `<rect x="-6" y="-4" width="52" height="38" rx="5" fill="${P.teal}"/><rect x="0" y="2" width="40" height="26" rx="2" fill="${P.sky}"/>` +
  `<path d="M-30 18 q10 22 34 18" fill="none" stroke="${P.orange}" stroke-width="6" stroke-linecap="round"/><path d="M0 28 l10 8 l-12 6 z" fill="${P.orange}"/></g>`;

/** Tarcza MFA (aplikacja uwierzytelniająca). */
const shieldIcon = (s: number, fill: string = P.purple) =>
  `<g transform="scale(${s / 100})"><path d="M0 -44 L36 -30 V2 C36 26 18 40 0 48 C-18 40 -36 26 -36 2 V-30 Z" fill="${fill}"/>` +
  `<rect x="-12" y="-6" width="24" height="20" rx="4" fill="${P.white}"/><path d="M-7 -6 v-6 a7 7 0 0 1 14 0 v6" fill="none" stroke="${P.white}" stroke-width="4"/></g>`;

/* ---------- biurko Karola ---------- */

/** Plakat „IT nigdy nie prosi o kody” — bez słów: telefon + dymek z liczbą przekreśloną. */
export const noCodePoster: PropFn<{ w?: number; h?: number }> = ({ w = 190, h = 250 }) => ({
  w, h,
  svg:
    `<rect x="6" y="8" width="${w}" height="${h}" rx="6" fill="${P.ink}" opacity="0.15"/>` +
    `<rect width="${w}" height="${h}" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="4"/>` +
    `<rect x="10" y="10" width="${w - 20}" height="46" rx="4" fill="${P.purple}"/>` +
    `<g transform="translate(${w / 2} 33)">${shieldIcon(34, P.white)}</g>` +
    `<g transform="translate(58 132)">${handset(80, P.ink, -10)}</g>` +
    `<g transform="translate(${w - 78} 92)"><path d="M-40 -26 h80 a10 10 0 0 1 10 10 v36 a10 10 0 0 1 -10 10 h-50 l-18 16 v-16 h-12 a10 10 0 0 1 -10 -10 v-36 a10 10 0 0 1 10 -10 z" fill="${P.wall2}"/>` +
    t(0, 14, '47', 30, { anchor: 'middle', bold: true, fill: P.ink }) +
    `<path d="M-30 -16 L30 30" stroke="${P.red}" stroke-width="7" stroke-linecap="round"/></g>` +
    `<circle cx="${w / 2}" cy="${h - 52}" r="26" fill="none" stroke="${P.red}" stroke-width="6"/><path d="M${w / 2 - 18} ${h - 70} L${w / 2 + 18} ${h - 34}" stroke="${P.red}" stroke-width="6"/>` +
    bars(26, h - 20, [w - 52], 0, 6),
});

/** Monitor z pulpitem: tapeta, ikony i otwarte okno narzędzia zdalnej pomocy (połączone). */
export const monitorRemote: PropFn<{ connected?: boolean }> = ({ connected = true }) => {
  const w = 420, h = 332;
  const icons = [0, 1, 2].map(i => `<rect x="${22}" y="${22 + i * 60}" width="38" height="38" rx="8" fill="${P.white}" opacity="0.85"/>`).join('');
  return {
    w, h,
    svg:
      `<rect x="160" y="280" width="100" height="50" rx="8" fill="${P.greyDark}"/><rect x="100" y="316" width="220" height="16" rx="8" fill="${P.greyDark}"/>` +
      `<rect width="420" height="290" rx="16" fill="${P.ink}"/>` +
      `<g transform="translate(18 18)"><clipPath id="mr-clip"><rect width="384" height="250" rx="6"/></clipPath><g clip-path="url(#mr-clip)"><rect width="384" height="250" rx="6" fill="${P.purpleDark}"/>` +
      `<circle cx="300" cy="60" r="90" fill="${P.purple}" opacity="0.5"/></g>` + icons +
      `<g transform="translate(41 221)">${remoteIcon(34)}</g><rect x="22" y="202" width="38" height="38" rx="8" fill="none" stroke="${P.yellow}" stroke-width="3" class="a-pulse"/>` +
      `<g transform="translate(110 44)"><rect width="230" height="150" rx="8" fill="${P.white}"/><rect width="230" height="28" rx="8" fill="${P.teal}"/><rect y="20" width="230" height="8" fill="${P.teal}"/>` +
      `<g transform="translate(50 86)">${remoteIcon(60)}</g>` +
      bars(110, 62, [100, 80, 90], 18, 8) +
      (connected ? `<circle class="a-blink" cx="118" cy="128" r="7" fill="${P.green}"/>` + bars(132, 124, [70], 0, 8, P.green) : '') + `</g>` +
      `<rect y="232" width="384" height="18" fill="${P.ink}" opacity="0.55"/></g>`,
    parts: { screen: { x: 18, y: 18, w: 384, h: 250 } },
  };
};

/** Smartfon leżący na biurku, ekranem do góry, z odznaką powiadomień. */
export const phoneFaceUp: PropFn<{ badge?: string }> = ({ badge = '6' }) => {
  const w = 96, h = 176;
  return {
    w, h,
    svg:
      `<rect x="6" y="8" width="${w}" height="${h}" rx="16" fill="${P.ink}" opacity="0.2"/>` +
      `<rect width="${w}" height="${h}" rx="16" fill="${P.ink}"/><rect x="7" y="16" width="${w - 14}" height="${h - 32}" rx="8" fill="${P.purpleDark}"/>` +
      [0, 1, 2].map(i => `<rect x="14" y="${30 + i * 34}" width="${w - 28}" height="28" rx="6" fill="${P.white}" opacity="${0.92 - i * 0.2}"/><g transform="translate(26 ${44 + i * 34})">${shieldIcon(16, P.red)}</g>` + bars(40, 38 + i * 34, [36, 24], 10, 5)).join('') +
      `<g class="a-bounce"><circle cx="${w - 8}" cy="10" r="14" fill="${P.red}"/>${t(w - 8, 16, badge, 16, { anchor: 'middle', bold: true, fill: P.white })}</g>`,
  };
};

/* ---------- telefon Karola (zbliżenie ekranu, scena zagnieżdżona) ---------- */

/**
 * Ekran telefonu 9:16 z dwoma kaflami: powiadomienia MFA i rejestr połączeń.
 * Etykiety kafli w warstwie tekstu (sloty `slot-powiadomienia-tytul`, `slot-rejestr-tytul`).
 */
export const phoneHomeTiles: PropFn<Record<string, never>> = () => {
  const w = 620, h = 1180, sx = 34, sy = 90, sw = w - 68, sh = h - 170;
  const tile = (y: number, hh: number, icon: string, rows: string) =>
    `<rect x="${sx + 30}" y="${y}" width="${sw - 60}" height="${hh}" rx="26" fill="${P.white}"/>` +
    `<g transform="translate(${sx + 92} ${y + 62})">${icon}</g>` + rows;
  const mfaRows = Array.from({ length: 6 }, (_, i) => {
    const y = 330 + i * 46;
    return `<rect x="${sx + 60}" y="${y - 20}" width="${sw - 120}" height="38" rx="10" fill="${P.wall}"/>` +
      `<g transform="translate(${sx + 84} ${y})">${shieldIcon(20, P.purple)}</g>` + bars(sx + 110, y - 8, [150], 0, 9) +
      `<g transform="translate(${sx + sw - 90} ${y})"><circle r="13" fill="${P.red}"/><path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="${P.white}" stroke-width="4" stroke-linecap="round"/></g>`;
  }).join('');
  const callRows = [[P.red, true], [P.green, false], [P.grey, false]].map(([c, hl], i) => {
    const y = 830 + i * 60;
    return `<rect x="${sx + 60}" y="${y - 26}" width="${sw - 120}" height="50" rx="12" fill="${hl ? '#FFE9EA' : P.wall}"/>` +
      `<g transform="translate(${sx + 90} ${y})">${handset(34, c as string, 0)}</g>` + bars(sx + 124, y - 12, [170, 110], 16, 8) +
      bars(sx + sw - 150, y - 4, [70], 0, 8, P.greyDark);
  }).join('');
  return {
    w, h,
    svg:
      `<rect x="10" y="14" width="${w}" height="${h}" rx="70" fill="${P.ink}" opacity="0.22"/>` +
      `<rect width="${w}" height="${h}" rx="70" fill="${P.ink}"/>` +
      `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="30" fill="${P.purpleDark}"/>` +
      `<clipPath id="pht-clip"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="30"/></clipPath><circle clip-path="url(#pht-clip)" cx="${sx + sw - 60}" cy="${sy + 120}" r="220" fill="${P.purple}" opacity="0.45"/>` +
      `<rect x="${w / 2 - 70}" y="36" width="140" height="22" rx="11" fill="#1B1730"/>` +
      bars(sx + 40, sy + 40, [60], 0, 10, P.white) + `<rect x="${sx + sw - 110}" y="${sy + 38}" width="70" height="14" rx="7" fill="${P.white}" opacity="0.8"/>` +
      tile(sy + 110, 480, shieldIcon(60, P.purple), mfaRows) +
      `<g class="a-bounce"><circle cx="${sx + sw - 44}" cy="${sy + 124}" r="26" fill="${P.red}"/>${t(sx + sw - 44, sy + 134, '6', 28, { anchor: 'middle', bold: true, fill: P.white })}</g>` +
      tile(sy + 620, 300, `<circle r="34" fill="${P.green}"/>${handset(40, P.white, 0)}`, callRows) +
      `<rect x="${w / 2 - 90}" y="${h - 50}" width="180" height="10" rx="5" fill="${P.white}" opacity="0.6"/>`,
    parts: {
      powiadomienia: { x: sx + 30, y: sy + 110, w: sw - 60, h: 480 },
      rejestr: { x: sx + 30, y: sy + 620, w: sw - 60, h: 300 },
      'slot-powiadomienia-tytul': { x: sx + 140, y: sy + 150, w: sw - 240, h: 44 },
      'slot-rejestr-tytul': { x: sx + 140, y: sy + 660, w: sw - 240, h: 44 },
    },
  };
};

/* ---------- rozmowa na żywo: ekran połączenia przychodzącego ---------- */

export const incomingCallScreen: PropFn<{ number?: string; ringing?: boolean }> = ({ number = '12 3XX XX 41', ringing = true }) => {
  const w = 620, h = 1180, sx = 34, sy = 90, sw = w - 68, sh = h - 170, cx = w / 2;
  const waves = ringing
    ? [0, 1, 2].map(i => `<circle class="a-wave${i ? ` d${i}` : ''}" cx="${cx}" cy="440" r="${150 + i * 42}" fill="none" stroke="${P.white}" stroke-width="4" opacity="0.5"/>`).join('')
    : '';
  return {
    w, h,
    svg:
      `<defs><linearGradient id="callbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B2F8F"/><stop offset="1" stop-color="#1B1536"/></linearGradient></defs>` +
      `<rect x="10" y="14" width="${w}" height="${h}" rx="70" fill="${P.ink}" opacity="0.22"/>` +
      `<rect width="${w}" height="${h}" rx="70" fill="${P.ink}"/>` +
      `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="30" fill="url(#callbg)"/>` +
      `<rect x="${cx - 70}" y="36" width="140" height="22" rx="11" fill="#1B1730"/>` +
      waves +
      `<circle cx="${cx}" cy="440" r="132" fill="${P.purple}"/>` +
      // sylwetka bez twarzy + zestaw słuchawkowy
      `<clipPath id="avc"><circle cx="${cx}" cy="440" r="132"/></clipPath><g clip-path="url(#avc)">` +
      `<circle cx="${cx}" cy="410" r="56" fill="#8E82F0"/><path d="M${cx - 110} 580 c0 -80 50 -110 110 -110 s110 30 110 110 z" fill="#8E82F0"/></g>` +
      `<path d="M${cx - 62} 410 a62 62 0 0 1 124 0" fill="none" stroke="${P.ink}" stroke-width="12"/>` +
      `<rect x="${cx - 74}" y="398" width="22" height="40" rx="10" fill="${P.ink}"/><rect x="${cx + 52}" y="398" width="22" height="40" rx="10" fill="${P.ink}"/>` +
      `<path d="M${cx - 60} 436 q10 44 50 44" fill="none" stroke="${P.ink}" stroke-width="7"/><circle cx="${cx - 6}" cy="480" r="9" fill="${P.ink}"/>` +
      // slot na nazwę (HTML) i numer zamaskowany
      `<rect x="${sx + 60}" y="210" width="${sw - 120}" height="1" fill="none"/>` +
      t(cx, 670, number, 40, { anchor: 'middle', fill: P.white, opacity: 0.85, spacing: 2 }) +
      // przyciski: odrzuć / odbierz (bez słów)
      `<g transform="translate(${cx - 150} ${h - 250})"><circle r="62" fill="${P.red}"/>${handset(70, P.white, 135)}</g>` +
      `<g transform="translate(${cx + 150} ${h - 250})"${ringing ? ' class="a-bounce"' : ''}><circle r="62" fill="${P.green}"/>${handset(70, P.white, 0)}</g>` +
      `<rect x="${w / 2 - 90}" y="${h - 50}" width="180" height="10" rx="5" fill="${P.white}" opacity="0.6"/>`,
    parts: {
      'slot-caller': { x: sx + 50, y: 170, w: sw - 100, h: 70 },
      'slot-status': { x: sx + 80, y: 245, w: sw - 160, h: 40 },
      'slot-choices': { x: sx + 30, y: 720, w: sw - 60, h: 250 },
      odrzuc: { x: cx - 212, y: h - 312, w: 124, h: 124 },
      odbierz: { x: cx + 88, y: h - 312, w: 124, h: 124 },
    },
  };
};

/* ---------- awatary ---------- */

export const avatarBust: PropFn<{ who?: 'karol' | 'pawel' }> = ({ who = 'karol' }) => {
  const w = 256, h = 256, cx = 128;
  const skin = who === 'karol' ? '#F2C7A5' : '#E0AC86';
  const hair = who === 'karol' ? '#5A3A22' : '#2E2A33';
  const top = who === 'karol' ? P.purple : P.teal;
  const hairSvg = who === 'karol'
    ? `<path d="M${cx - 50} 104 c-4 -46 26 -66 56 -64 c30 -2 52 20 46 64 c-6 -20 -20 -30 -40 -30 c-24 0 -48 8 -62 30 z" fill="${hair}"/>`
    : `<path d="M${cx - 50} 100 c0 -40 22 -58 52 -58 c30 0 50 18 48 58 c-10 -16 -30 -22 -52 -22 c-20 0 -38 8 -48 22 z" fill="${hair}"/>`;
  const extra = who === 'karol'
    ? // koszula z krawatem
      `<path d="M${cx - 18} 190 l18 22 l18 -22 z" fill="${P.white}"/><path d="M${cx} 198 l-8 12 l8 40 l8 -40 z" fill="${P.orange}"/>`
    : // polo + smycz z identyfikatorem + okulary
      `<path d="M${cx - 30} 188 l30 50 l30 -50" fill="none" stroke="${P.purple}" stroke-width="6"/><rect x="${cx - 16}" y="232" width="32" height="22" rx="4" fill="${P.white}"/>` +
      `<g fill="none" stroke="${P.ink}" stroke-width="5"><circle cx="${cx - 20}" cy="116" r="15"/><circle cx="${cx + 20}" cy="116" r="15"/><path d="M${cx - 5} 116 h10"/></g>`;
  return {
    w, h,
    svg:
      `<clipPath id="av-${who}"><circle cx="${cx}" cy="${cx}" r="124"/></clipPath>` +
      `<circle cx="${cx}" cy="${cx}" r="124" fill="${who === 'karol' ? '#EDE9FF' : '#DDF3F6'}"/>` +
      `<g clip-path="url(#av-${who})">` +
      `<path d="M${cx - 100} 260 c0 -60 40 -80 100 -80 s100 20 100 80 z" fill="${top}"/>` +
      `<rect x="${cx - 18}" y="160" width="36" height="30" fill="${skin}"/>` +
      `<ellipse cx="${cx}" cy="116" rx="50" ry="58" fill="${skin}"/>` + hairSvg +
      `<circle cx="${cx - 20}" cy="118" r="5" fill="${P.ink}"/><circle cx="${cx + 20}" cy="118" r="5" fill="${P.ink}"/>` +
      `<path d="M${cx - 16} 146 q16 ${who === 'karol' ? 6 : 10} 32 0" fill="none" stroke="${P.ink}" stroke-width="4" stroke-linecap="round"/>` +
      extra + `</g>` +
      `<circle cx="${cx}" cy="${cx}" r="124" fill="none" stroke="${P.white}" stroke-width="6"/>`,
  };
};

/* ---------- trofea modułu 2 ---------- */

const sparkle = (x: number, y: number, s: number, c: string = P.white) =>
  `<path d="M${x} ${y - s} q${s * 0.18} ${s * 0.82} ${s} ${s} q${-s * 0.82} ${s * 0.18} ${-s} ${s} q${-s * 0.18} ${-s * 0.82} ${-s} ${-s} q${s * 0.82} ${-s * 0.18} ${s} ${-s} z" fill="${c}"/>`;
const banner = (cx: number, y: number, w: number, label: string, fill: string, dark: string, size = 24) =>
  `<path d="M${cx - w / 2 - 34} ${y + 8} h34 v44 h-34 l14 -22 z" fill="${dark}"/><path d="M${cx + w / 2 + 34} ${y + 8} h-34 v44 h34 l-14 -22 z" fill="${dark}"/>` +
  `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="52" rx="6" fill="${fill}"/>` +
  `<path d="M${cx - w / 2} ${y + 52} l20 12 v-12 z M${cx + w / 2} ${y + 52} l-20 12 v-12 z" fill="${P.ink}" opacity="0.45"/>` +
  t(cx, y + 35, label, size, { anchor: 'middle', bold: true, fill: P.white, spacing: 2 });
const pill = (cx: number, y: number, w: number, label: string, fill: string) =>
  `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="36" rx="18" fill="${fill}"/>` + t(cx, y + 25, label, 18, { anchor: 'middle', bold: true, fill: P.white, spacing: 3 });
const octPts = (cx: number, cy: number, R: number) =>
  Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`; }).join(' ');
const hexPts = (cx: number, cy: number, R: number) =>
  Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + i * Math.PI / 3; return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`; }).join(' ');
const star5 = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r : R, a = -Math.PI / 2 + i * Math.PI / 5; return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; }).join(' ');

/** Kolory rang. RARE = szafir (nowa ranga w module 2). */
export const RANK = {
  rare: { fill: '#1F7FB8', dark: '#0E4E75', rim: 'url(#h-silver)' },
  legendary: { fill: '#C9962B', dark: '#7A5A14' },
  secret: { fill: '#C2417A', dark: '#7A2150' },
} as const;

export const trophyHelpdesk: PropFn<{ kind?: 'dead-air' | 'perfect-pitch' | 'full-transcript' | 'off-the-record'; locked?: boolean }> = ({ kind = 'dead-air', locked = false }) => {
  const w = 512, h = 512, cx = 256, cy = 236;
  const defs =
    `<defs>` +
    `<linearGradient id="h-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1A8"/><stop offset="0.45" stop-color="#F2C94C"/><stop offset="0.7" stop-color="#C9962B"/><stop offset="1" stop-color="#FFE38A"/></linearGradient>` +
    `<linearGradient id="h-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#C9CBDA"/><stop offset="1" stop-color="#8C8FA8"/></linearGradient>` +
    `<linearGradient id="h-sapphire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4FB3E8"/><stop offset="1" stop-color="#123F7A"/></linearGradient>` +
    `<linearGradient id="h-enamel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A7BFF"/><stop offset="1" stop-color="#3F32B5"/></linearGradient>` +
    `<linearGradient id="h-neon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B1236"/><stop offset="0.6" stop-color="#3B1D5E"/><stop offset="1" stop-color="#C2417A"/></linearGradient>` +
    `<radialGradient id="h-glow" cx="0.5" cy="0.45" r="0.55"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="h-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.5"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="h-oct"><polygon points="${octPts(cx, cy, 150)}"/></clipPath>` +
    `<clipPath id="h-hex"><polygon points="${hexPts(cx, cy, 158)}"/></clipPath>` +
    `<clipPath id="h-sh"><path d="M${cx} ${cy - 168} L${cx + 146} ${cy - 118} V${cy + 10} C${cx + 146} ${cy + 110}, ${cx + 70} ${cy + 160}, ${cx} ${cy + 190} C${cx - 70} ${cy + 160}, ${cx - 146} ${cy + 110}, ${cx - 146} ${cy + 10} V${cy - 118} Z"/></clipPath>` +
    `</defs>`;
  const halo = `<circle cx="${cx}" cy="${cy}" r="230" fill="url(#h-glow)"/>`;
  const rare = kind === 'dead-air' || kind === 'perfect-pitch';
  const shieldPath = `M${cx} ${cy - 190} L${cx + 168} ${cy - 134} V${cy + 10} C${cx + 168} ${cy + 124}, ${cx + 80} ${cy + 180}, ${cx} ${cy + 214} C${cx - 80} ${cy + 180}, ${cx - 168} ${cy + 124}, ${cx - 168} ${cy + 10} V${cy - 134} Z`;

  if (locked) {
    const shape = rare ? `<polygon points="${octPts(cx, cy, 172)}" fill="#3A3550"/><polygon points="${octPts(cx, cy, 150)}" fill="#4A4466"/>`
      : kind === 'off-the-record' ? `<polygon points="${hexPts(cx, cy, 178)}" fill="#3A3550"/><polygon points="${hexPts(cx, cy, 158)}" fill="#4A4466"/>`
      : `<path d="${shieldPath}" fill="#3A3550"/>`;
    return {
      w, h,
      svg: defs + `<g opacity="0.9">${shape}</g>` +
        `<rect x="${cx - 44}" y="${cy - 6}" width="88" height="72" rx="12" fill="#6F6A8A"/><path d="M${cx - 27} ${cy - 6} v-22 a27 27 0 0 1 54 0 v22" fill="none" stroke="#6F6A8A" stroke-width="14"/>` +
        (kind === 'off-the-record' ? t(cx, cy + 128, '???', 40, { anchor: 'middle', bold: true, fill: '#8C87A8', spacing: 8 }) : '') +
        banner(cx, 420, 300, kind === 'off-the-record' ? 'SECRET' : 'LOCKED', '#6F6A8A', '#4A4466', 24),
    };
  }

  const rareFrame = (inner: string) =>
    `<polygon points="${octPts(cx, cy + 8, 178)}" fill="${P.ink}" opacity="0.25"/>` +
    `<polygon points="${octPts(cx, cy, 178)}" fill="url(#h-silver)"/><polygon points="${octPts(cx, cy, 158)}" fill="#0E2F5C"/>` +
    `<g clip-path="url(#h-oct)"><rect x="${cx - 160}" y="${cy - 160}" width="320" height="320" fill="url(#h-sapphire)"/>` +
    Array.from({ length: 8 }, (_, i) => `<path d="M${cx} ${cy} L${cx + 260 * Math.cos(i * Math.PI / 4)} ${cy + 260 * Math.sin(i * Math.PI / 4)} L${cx + 260 * Math.cos(i * Math.PI / 4 + 0.22)} ${cy + 260 * Math.sin(i * Math.PI / 4 + 0.22)} Z" fill="${P.white}" opacity="0.06"/>`).join('') +
    inner +
    `<rect x="${cx - 160}" y="${cy - 160}" width="80" height="320" fill="url(#h-shine)" transform="rotate(20 ${cx} ${cy})" opacity="0.5"/></g>` +
    pill(cx, cy - 214, 110, 'RARE', RANK.rare.fill);

  if (kind === 'dead-air') {
    // Rozłączona słuchawka nad płaską linią — cisza w eterze
    const inner =
      `<path d="M${cx - 150} ${cy + 70} H${cx - 60} l14 -40 l16 80 l14 -40 H${cx + 150}" fill="none" stroke="#7FD0FF" stroke-width="5" opacity="0.35"/>` +
      `<path d="M${cx - 150} ${cy + 70} H${cx + 150}" fill="none" stroke="${P.white}" stroke-width="6" stroke-linecap="round"/>` +
      `<g transform="translate(${cx} ${cy - 30})"><circle r="74" fill="${P.red}"/>${handset(96, P.white, 135)}</g>` +
      [0, 1].map(i => `<path d="M${cx + 100 + i * 20} ${cy - 70} q16 40 0 80" fill="none" stroke="${P.white}" stroke-width="6" stroke-linecap="round" opacity="${0.5 - i * 0.2}"/>`).join('');
    return { w, h, svg: defs + halo + rareFrame(inner) + sparkle(cx + 150, cy - 130, 14) + sparkle(cx - 150, cy - 100, 10) + banner(cx, 426, 280, 'DEAD AIR', RANK.rare.fill, RANK.rare.dark) };
  }

  if (kind === 'perfect-pitch') {
    // Fala dźwiękowa z siedmioma czerwonymi chorągiewkami na szczytach
    const amps = [12, 32, 18, 48, 24, 62, 28, 44, 16, 56, 20, 38, 12];
    const peaks = [1, 3, 5, 7, 9, 11, 12];
    const x0 = cx - 120, dx = 20;
    const wave = amps.map((a, i) => `<rect x="${x0 + i * dx - 5}" y="${cy + 14 - a}" width="10" height="${a * 2}" rx="5" fill="${P.white}" opacity="${peaks.includes(i) ? 1 : 0.55}"/>`).join('');
    const flags = peaks.map(i => { const x = x0 + i * dx, y = cy + 14 - amps[i] - 8; return `<path d="M${x} ${y} v-34" stroke="${P.white}" stroke-width="3"/><path d="M${x} ${y - 34} h20 l-6 8 l6 8 h-20 z" fill="${P.red}"/>`; }).join('');
    return { w, h, svg: defs + halo + rareFrame(wave + flags + t(cx, cy + 122, '7/7', 30, { anchor: 'middle', bold: true, fill: P.white, spacing: 2 })) + sparkle(cx + 150, cy - 130, 14) + sparkle(cx - 146, cy + 60, 10) + banner(cx, 426, 360, 'PERFECT PITCH', RANK.rare.fill, RANK.rare.dark) };
  }

  if (kind === 'full-transcript') {
    // Złota tarcza z kartką transkrypcji i cudzysłowem
    const page =
      `<g transform="rotate(-5 ${cx} ${cy})"><rect x="${cx - 86}" y="${cy - 110}" width="172" height="210" rx="10" fill="${P.white}"/>` +
      Array.from({ length: 7 }, (_, i) => `<rect x="${cx - 64}" y="${cy - 80 + i * 24}" width="${i % 3 === 2 ? 80 : 128}" height="9" rx="4.5" fill="${i === 3 ? '#F7B4B6' : P.grey}"/>`).join('') +
      t(cx - 58, cy - 44, '\u201C', 110, { anchor: 'middle', bold: true, fill: P.orange }) + `</g>` +
      `<g transform="translate(${cx + 70} ${cy + 76})"><circle r="40" fill="${P.green}"/><path d="M-18 0 l12 12 l24 -26" fill="none" stroke="${P.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    return {
      w, h,
      svg: defs + halo +
        [-1, 1].map(sd => `<polygon points="${star5(cx + sd * 196, cy - 40, 22, 9)}" fill="url(#h-gold)"/><polygon points="${star5(cx + sd * 184, cy + 50, 14, 6)}" fill="url(#h-gold)"/>`).join('') +
        `<path d="${shieldPath}" transform="translate(0 8)" fill="${P.ink}" opacity="0.25"/><path d="${shieldPath}" fill="url(#h-gold)"/>` +
        `<g clip-path="url(#h-sh)"><rect x="${cx - 160}" y="${cy - 170}" width="320" height="360" fill="url(#h-enamel)"/>${page}` +
        `<rect x="${cx - 160}" y="${cy - 170}" width="80" height="360" fill="url(#h-shine)" transform="rotate(20 ${cx} ${cy})" opacity="0.5"/></g>` +
        sparkle(cx + 118, cy - 150, 16, '#FFF1A8') + sparkle(cx - 128, cy - 118, 12, '#FFF1A8') +
        pill(cx, cy - 234, 192, 'LEGENDARY', RANK.legendary.fill) +
        banner(cx, 426, 400, 'FULL TRANSCRIPT', RANK.legendary.fill, RANK.legendary.dark, 22),
    };
  }

  // off-the-record — SEKRET: neonowy heksagon, mikrofon z czerwoną diodą nagrywania i przekreślonym dymkiem
  return {
    w, h,
    svg: defs + halo +
      `<polygon points="${hexPts(cx, cy + 6, 178)}" fill="${P.ink}" opacity="0.25"/>` +
      `<polygon points="${hexPts(cx, cy, 178)}" fill="url(#h-silver)"/><polygon points="${hexPts(cx, cy, 158)}" fill="#1B1236"/>` +
      `<g clip-path="url(#h-hex)"><rect x="${cx - 170}" y="${cy - 170}" width="340" height="340" fill="url(#h-neon)"/>` +
      Array.from({ length: 9 }, (_, i) => `<rect x="${cx - 150}" y="${cy + 70 + i * 10}" width="300" height="3" fill="#C2417A" opacity="${0.15 + i * 0.05}"/>`).join('') +
      // mikrofon
      `<rect x="${cx - 38}" y="${cy - 118}" width="76" height="130" rx="38" fill="url(#h-silver)"/>` +
      Array.from({ length: 5 }, (_, i) => `<rect x="${cx - 30}" y="${cy - 96 + i * 20}" width="60" height="5" rx="2.5" fill="#8C8FA8"/>`).join('') +
      `<path d="M${cx - 62} ${cy - 20} a62 62 0 0 0 124 0" fill="none" stroke="url(#h-silver)" stroke-width="10"/>` +
      `<rect x="${cx - 6}" y="${cy + 42}" width="12" height="40" fill="url(#h-silver)"/><rect x="${cx - 44}" y="${cy + 80}" width="88" height="12" rx="6" fill="url(#h-silver)"/>` +
      `<circle class="a-blink" cx="${cx + 88}" cy="${cy - 96}" r="16" fill="${P.red}"/>` +
      // dymek z wielokropkiem = zdanie, które miało nie paść
      `<g transform="translate(${cx - 84} ${cy - 64}) scale(0.8)"><path d="M-44 -30 h88 a12 12 0 0 1 12 12 v34 a12 12 0 0 1 -12 12 h-54 l-18 16 v-16 h-16 a12 12 0 0 1 -12 -12 v-34 a12 12 0 0 1 12 -12 z" fill="${P.white}"/>` +
      [-22, 0, 22].map(x => `<circle cx="${x}" cy="-2" r="6" fill="#C2417A"/>`).join('') + `</g>` +
      `<rect x="${cx - 170}" y="${cy - 170}" width="90" height="340" fill="url(#h-shine)" transform="rotate(18 ${cx} ${cy})" opacity="0.5"/></g>` +
      sparkle(cx + 132, cy + 40, 12, '#FFD36E') + sparkle(cx - 140, cy + 70, 10) +
      pill(cx, cy - 214, 120, 'SECRET', RANK.secret.fill) +
      banner(cx, 420, 380, 'OFF THE RECORD', RANK.secret.fill, RANK.secret.dark, 22),
  };
};


/** Smartfon leżący płasko na blacie (widok z lekkim skosem), z odznaką powiadomień nad nim. */
export const phoneLying: PropFn<{ badge?: string }> = ({ badge = '6' }) => {
  const w = 150, h = 58;
  return {
    w, h,
    svg:
      `<ellipse cx="${w / 2}" cy="${h - 6}" rx="${w / 2}" ry="6" fill="${P.ink}" opacity="0.18"/>` +
      `<path d="M18 28 L140 28 L128 52 L6 52 Z" fill="${P.ink}"/>` +
      `<path d="M24 31 L132 31 L122 49 L14 49 Z" fill="${P.purpleDark}"/>` +
      `<path d="M30 34 L80 34 L76 40 L26 40 Z" fill="${P.white}" opacity="0.85"/>` +
      `<path d="M26 42 L70 42 L67 46 L23 46 Z" fill="${P.white}" opacity="0.55"/>` +
      `<g class="a-bounce"><circle cx="132" cy="14" r="13" fill="${P.red}"/>${t(132, 20, badge, 16, { anchor: 'middle', bold: true, fill: P.white })}</g>`,
  };
};

/** Karteczka leżąca płasko na blacie (bez czytelnego tekstu — treść pokazuje zbliżenie). */
export const stickyLying: PropFn<{ color?: string }> = ({ color = P.yellow }) => {
  const w = 104, h = 30;
  return {
    w, h,
    svg:
      `<path d="M14 4 L100 4 L92 28 L4 28 Z" fill="${P.ink}" opacity="0.12" transform="translate(3 2)"/>` +
      `<path d="M14 4 L100 4 L92 28 L4 28 Z" fill="${color}"/>` +
      `<path d="M14 4 L100 4 L98 9 L12 9 Z" fill="${P.yellowDark}" opacity="0.6"/>` +
      `<path d="M22 15 L70 15 L69 18 L21 18 Z" fill="${P.ink}" opacity="0.5"/>` +
      `<path d="M18 22 L56 22 L55 25 L17 25 Z" fill="${P.purpleDark}" opacity="0.5"/>`,
  };
};


/* ================= paczka 2 ================= */

/** Rama telefonu (front) z ekranem; zwraca SVG ramy + współrzędne ekranu. */
const phoneShell = (w: number, h: number, screenFill: string) => {
  const sx = Math.round(w * 0.055), sy = Math.round(h * 0.075), sw = w - 2 * sx, sh = h - Math.round(h * 0.145);
  return {
    sx, sy, sw, sh,
    svg:
      `<rect x="10" y="14" width="${w}" height="${h}" rx="${w * 0.11}" fill="${P.ink}" opacity="0.22"/>` +
      `<rect width="${w}" height="${h}" rx="${w * 0.11}" fill="${P.ink}"/>` +
      `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${w * 0.05}" fill="${screenFill}"/>` +
      `<rect x="${w / 2 - w * 0.11}" y="${h * 0.03}" width="${w * 0.22}" height="${h * 0.018}" rx="${h * 0.009}" fill="#1B1730"/>` +
      `<rect x="${w / 2 - w * 0.15}" y="${h - h * 0.04}" width="${w * 0.3}" height="${h * 0.008}" rx="4" fill="${P.white}" opacity="0.6"/>`,
  };
};

/** Zbliżenie: lista 6 odrzuconych próśb o logowanie (godziny w grafice, opisy w textLayer). */
export const mfaListZoom: PropFn<Record<string, never>> = () => {
  const w = 800, h = 1500;
  const sh = phoneShell(w, h, '#F4F5FB');
  const times = ['8:55', '8:55', '8:56', '8:56', '8:57', '8:57'];
  const rowH = 150, y0 = sh.sy + 190;
  const parts: Record<string, { x: number; y: number; w: number; h: number }> = { 'slot-tytul': { x: sh.sx + 150, y: sh.sy + 70, w: sh.sw - 200, h: 60 } };
  const rows = times.map((tm, i) => {
    const y = y0 + i * (rowH + 18);
    parts[`slot-wiersz-${i + 1}`] = { x: sh.sx + 150, y: y + 28, w: sh.sw - 330, h: rowH - 56 };
    return `<rect x="${sh.sx + 30}" y="${y}" width="${sh.sw - 60}" height="${rowH}" rx="22" fill="${P.white}"/>` +
      `<g transform="translate(${sh.sx + 96} ${y + rowH / 2})">${shieldIcon(52, P.purple)}</g>` +
      t(sh.sx + sh.sw - 170, y + 62, tm, 34, { bold: true, fill: P.greyDark }) +
      `<g transform="translate(${sh.sx + sh.sw - 88} ${y + rowH / 2 + 18})"><circle r="24" fill="${P.red}"/><path d="M-10 -10 L10 10 M10 -10 L-10 10" stroke="${P.white}" stroke-width="6" stroke-linecap="round"/></g>`;
  }).join('');
  return {
    w, h,
    svg: sh.svg + `<rect x="${sh.sx}" y="${sh.sy}" width="${sh.sw}" height="150" rx="${w * 0.05}" fill="${P.purple}"/><rect x="${sh.sx}" y="${sh.sy + 110}" width="${sh.sw}" height="40" fill="${P.purple}"/>` +
      `<g transform="translate(${sh.sx + 90} ${sh.sy + 100})">${shieldIcon(60, P.white)}</g>` + rows,
    parts,
  };
};

/** Zbliżenie: rejestr połączeń (3 wiersze, numery zamaskowane w grafice, nazwy w textLayer). */
export const callLogZoom: PropFn<Record<string, never>> = () => {
  const w = 800, h = 1500;
  const sh = phoneShell(w, h, '#F4F5FB');
  const rows: Array<[string, string, boolean, string]> = [
    ['12 3XX XX 41', '9:02', true, P.red], ['214', '10:15', false, P.green], ['12 3XX XX 00', 'wt.', false, P.grey],
  ];
  const parts: Record<string, { x: number; y: number; w: number; h: number }> = { 'slot-tytul': { x: sh.sx + 150, y: sh.sy + 70, w: sh.sw - 200, h: 60 } };
  const body = rows.map(([num, tm, hl, col], i) => {
    const y = sh.sy + 200 + i * 220;
    parts[`slot-nazwa-${i + 1}`] = { x: sh.sx + 160, y: y + 30, w: sh.sw - 360, h: 60 };
    return `<rect x="${sh.sx + 30}" y="${y}" width="${sh.sw - 60}" height="190" rx="24" fill="${hl ? '#FFE9EA' : P.white}"/>` +
      `<g transform="translate(${sh.sx + 96} ${y + 70})"><circle r="40" fill="${col}" opacity="0.18"/>${handset(52, col, 0)}</g>` +
      t(sh.sx + 160, y + 140, num, 36, { fill: P.greyDark, spacing: 1 }) +
      t(sh.sx + sh.sw - 70, y + 80, tm, 34, { anchor: 'end', bold: true, fill: P.greyDark });
  }).join('');
  return {
    w, h,
    svg: sh.svg + `<rect x="${sh.sx}" y="${sh.sy}" width="${sh.sw}" height="150" rx="${w * 0.05}" fill="${P.green}"/><rect x="${sh.sx}" y="${sh.sy + 110}" width="${sh.sw}" height="40" fill="${P.green}"/>` +
      `<g transform="translate(${sh.sx + 90} ${sh.sy + 76})">${handset(60, P.white, 0)}</g>` + body,
    parts,
  };
};

/** Ikona pulpitu z narzędziem zdalnej pomocy (bez podpisu — podpis w textLayer). */
export const desktopRemoteIcon: PropFn<{ highlight?: boolean }> = ({ highlight = true }) => ({
  w: 120, h: 128,
  svg: `<rect x="10" y="4" width="100" height="96" rx="18" fill="${P.white}" opacity="0.92"/>` +
    `<g transform="translate(60 52)">${remoteIcon(80)}</g>` +
    (highlight ? `<rect x="4" y="-2" width="112" height="108" rx="22" fill="none" stroke="${P.yellow}" stroke-width="5" class="a-pulse"/>` : ''),
});

/** Okno narzędzia zdalnej pomocy na pulpicie (połączone), bez słów. */
export const remoteToolWindow: PropFn<Record<string, never>> = () => {
  const w = 560, h = 380;
  return {
    w, h,
    svg: `<rect x="8" y="10" width="${w}" height="${h}" rx="14" fill="${P.ink}" opacity="0.25"/>` +
      `<rect width="${w}" height="${h}" rx="14" fill="${P.white}"/><rect width="${w}" height="56" rx="14" fill="${P.teal}"/><rect y="40" width="${w}" height="16" fill="${P.teal}"/>` +
      [0, 1, 2].map(i => `<circle cx="${w - 40 - i * 34}" cy="28" r="10" fill="${P.white}" opacity="0.8"/>`).join('') +
      `<g transform="translate(140 210)">${remoteIcon(150)}</g>` +
      bars(270, 130, [220, 170, 200], 38, 16) +
      `<circle class="a-blink" cx="284" cy="272" r="14" fill="${P.green}"/>` + bars(310, 264, [150], 0, 16, P.green),
    parts: { 'slot-okno': { x: 260, y: 110, w: 270, h: 200 } },
  };
};

/** Nagranie: rejestrator rozmów z góry (bez słów). */
export const recorderTop: PropFn<Record<string, never>> = () => ({
  w: 360, h: 220,
  svg: `<rect x="10" y="14" width="340" height="200" rx="26" fill="${P.ink}" opacity="0.2"/>` +
    `<rect width="340" height="200" rx="26" fill="#3B3354"/><rect x="24" y="24" width="200" height="90" rx="10" fill="#1E1840"/>` +
    Array.from({ length: 22 }, (_, i) => { const hh = [10, 26, 40, 18, 52, 30, 14, 44, 60, 28, 16, 50, 22, 38, 56, 20, 32, 48, 14, 36, 24, 42][i]; return `<rect x="${34 + i * 8.5}" y="${69 - hh / 2}" width="4.5" height="${hh}" rx="2" fill="${i < 9 ? '#8E82F0' : '#5A5178'}"/>`; }).join('') +
    `<circle cx="282" cy="68" r="34" fill="#2B2440"/><circle cx="282" cy="68" r="14" fill="${P.red}" class="a-blink"/>` +
    [0, 1, 2, 3].map(i => `<rect x="${24 + i * 52}" y="140" width="40" height="36" rx="8" fill="#5A5178"/>`).join('') +
    `<path d="M${48} 150 l12 8 l-12 8 z" fill="${P.white}"/>`,
});

/** Słuchawki z góry. */
export const headphonesTop: PropFn<Record<string, never>> = () => ({
  w: 300, h: 260,
  svg: `<path d="M50 190 C 20 80, 280 80, 250 190" fill="none" stroke="${P.ink}" stroke-width="22" stroke-linecap="round"/>` +
    `<path d="M50 190 C 20 80, 280 80, 250 190" fill="none" stroke="#443B63" stroke-width="10" stroke-linecap="round"/>` +
    `<ellipse cx="50" cy="200" rx="44" ry="52" fill="${P.ink}"/><ellipse cx="50" cy="200" rx="28" ry="36" fill="#443B63"/>` +
    `<ellipse cx="250" cy="200" rx="44" ry="52" fill="${P.ink}"/><ellipse cx="250" cy="200" rx="28" ry="36" fill="#443B63"/>` +
    `<path d="M250 250 q10 20 -30 10" fill="none" stroke="${P.ink}" stroke-width="5"/>`,
});

/** Wydruk transkrypcji z zaznaczeniami (bez czytelnych słów). */
export const transcriptPagesTop: PropFn<{ marks?: number }> = ({ marks = 3 }) => {
  const w = 520, h = 660;
  const lines = Array.from({ length: 14 }, (_, i) => {
    const y = 110 + i * 36, ww = [380, 300, 420, 260, 360, 400, 280, 390, 330, 410, 250, 370, 300, 340][i];
    const hl = i === 3 || i === 7 || i === 11;
    return (hl && marks ? `<rect x="46" y="${y - 12}" width="${ww + 8}" height="22" rx="4" fill="${P.yellow}" opacity="0.8"/>` : '') +
      `<rect x="50" y="${y - 5}" width="${ww}" height="9" rx="4.5" fill="${i % 3 === 0 ? P.purpleDark : P.grey}" opacity="${i % 3 === 0 ? 0.7 : 1}"/>`;
  }).join('');
  return {
    w, h,
    svg: `<g transform="rotate(4 ${w / 2} ${h / 2})"><rect x="30" y="20" width="${w - 40}" height="${h - 30}" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="2"/></g>` +
      `<rect x="10" y="16" width="${w - 20}" height="${h - 20}" rx="6" fill="${P.ink}" opacity="0.12"/>` +
      `<rect width="${w - 20}" height="${h - 20}" rx="6" fill="${P.white}"/>` +
      `<rect x="40" y="40" width="200" height="16" rx="8" fill="${P.ink}"/>` + lines +
      [0, 1, 2].map(i => `<circle cx="22" cy="${160 + i * 144}" r="14" fill="${P.red}"/>`).join(''),
  };
};

/** Zakreślacz z góry. */
export const highlighterTop: PropFn<Record<string, never>> = () => ({
  w: 260, h: 60,
  svg: `<g transform="rotate(-14 130 30)"><rect x="10" y="16" width="200" height="30" rx="10" fill="${P.yellow}"/><rect x="200" y="20" width="40" height="22" rx="6" fill="${P.yellowDark}"/><path d="M240 24 l16 7 l-16 7 z" fill="#C9A200"/><rect x="30" y="22" width="120" height="6" rx="3" fill="${P.white}" opacity="0.5"/></g>`,
});

/** Okno konsoli administratora: pasek tytułu (bez słów) + obszar dokumentu na HTML. */
export const adminConsoleWindow: PropFn<{ w?: number; h?: number }> = ({ w = 1480, h = 900 }) => ({
  w, h,
  svg: `<rect x="12" y="16" width="${w}" height="${h}" rx="18" fill="${P.ink}" opacity="0.22"/>` +
    `<rect width="${w}" height="${h}" rx="18" fill="${P.white}"/>` +
    `<rect width="${w}" height="72" rx="18" fill="#2B2440"/><rect y="54" width="${w}" height="18" fill="#2B2440"/>` +
    `<g transform="translate(46 36)">${shieldIcon(40, P.white)}</g>` +
    [0, 1, 2].map(i => `<circle cx="${w - 44 - i * 40}" cy="36" r="11" fill="${P.white}" opacity="${0.35 + i * 0.2}"/>`).join('') +
    `<rect x="0" y="72" width="${w}" height="${h - 72}" fill="#F7F8FC"/>`,
  parts: { 'slot-tytul': { x: 90, y: 16, w: w * 0.6, h: 40 }, 'slot-dokument': { x: Math.round(w * 0.04), y: 96, w: Math.round(w * 0.92), h: h - 120 } },
});

/** Duży telefon z rejestrem: dwa wpisy (części = hotspoty). */
export const callCompareTop: PropFn<Record<string, never>> = () => {
  const w = 560, h = 980;
  const sh = phoneShell(w, h, '#F4F5FB');
  const row = (y: number, col: string, hl: boolean, num: string) =>
    `<rect x="${sh.sx + 24}" y="${y}" width="${sh.sw - 48}" height="190" rx="22" fill="${hl ? '#FFE9EA' : P.white}"/>` +
    `<g transform="translate(${sh.sx + 84} ${y + 70})"><circle r="38" fill="${col}" opacity="0.18"/>${handset(50, col, 0)}</g>` +
    t(sh.sx + 144, y + 150, num, 30, { fill: P.greyDark, spacing: 1 });
  const y1 = sh.sy + 190, y2 = sh.sy + 410;
  return {
    w, h,
    svg: sh.svg + `<rect x="${sh.sx}" y="${sh.sy}" width="${sh.sw}" height="140" rx="${w * 0.05}" fill="${P.green}"/><rect x="${sh.sx}" y="${sh.sy + 100}" width="${sh.sw}" height="40" fill="${P.green}"/>` +
      `<g transform="translate(${sh.sx + 80} ${sh.sy + 70})">${handset(56, P.white, 0)}</g>` +
      row(y1, P.red, true, '12 3XX XX 41') + row(y2, P.green, false, '214'),
    parts: {
      'wpis-9-02': { x: sh.sx + 24, y: y1, w: sh.sw - 48, h: 190 },
      'wpis-10-15': { x: sh.sx + 24, y: y2, w: sh.sw - 48, h: 190 },
      'slot-nazwa-1': { x: sh.sx + 144, y: y1 + 34, w: sh.sw - 200, h: 56 },
      'slot-nazwa-2': { x: sh.sx + 144, y: y2 + 34, w: sh.sw - 200, h: 56 },
    },
  };
};

/** Wydruk strony intranetu „Kontakt z IT” (bez słów poza numerem 214). */
export const intranetSheet: PropFn<Record<string, never>> = () => {
  const w = 560, h = 700;
  return {
    w, h,
    svg: `<rect x="10" y="14" width="${w}" height="${h}" rx="6" fill="${P.ink}" opacity="0.14"/>` +
      `<rect width="${w}" height="${h}" rx="6" fill="${P.white}"/>` +
      `<rect width="${w}" height="90" rx="6" fill="${P.purpleDark}"/><rect y="70" width="${w}" height="20" fill="${P.purpleDark}"/>` +
      `<circle cx="60" cy="45" r="24" fill="${P.white}" opacity="0.9"/>` +
      `<rect x="40" y="130" width="${w - 80}" height="200" rx="14" fill="#EEEBFF"/>` +
      `<g transform="translate(110 230)"><circle r="54" fill="${P.purple}"/>${handset(64, P.white, 0)}</g>` +
      t(200, 262, '214', 88, { bold: true, fill: P.purpleDark }) +
      bars(40, 380, [420, 360, 440, 300, 400, 340], 42, 12),
    parts: { 'slot-naglowek': { x: 100, y: 22, w: w - 140, h: 46 }, 'slot-tresc': { x: 40, y: 360, w: w - 80, h: 300 } },
  };
};

/** Strona www drukarni „Zespół” — układ bez słów (tekst w textLayer). portrait=true → 900×2400. */
export const teamWebsite: PropFn<{ portrait?: boolean }> = ({ portrait = false }) => {
  const person = (x: number, y: number, w: number, h: number, col: string, hair: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${P.white}" stroke="${P.wall2}" stroke-width="3"/>` +
    `<rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="${h * 0.55}" rx="10" fill="${col}"/>` +
    `<circle cx="${x + w / 2}" cy="${y + 16 + h * 0.23}" r="${h * 0.1}" fill="#E7C2A0"/><path d="M${x + w / 2 - h * 0.1} ${y + 16 + h * 0.2} a${h * 0.1} ${h * 0.1} 0 0 1 ${h * 0.2} 0 z" fill="${hair}"/>` +
    `<path d="M${x + w / 2 - h * 0.2} ${y + 16 + h * 0.55} c0 -${h * 0.14} ${h * 0.4} -${h * 0.14} ${h * 0.4} 0 z" fill="${P.white}" opacity="0.85"/>` +
    bars(x + 24, y + h * 0.65 + 20, [w * 0.6, w * 0.45], 30, 12);
  const building = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${P.sky}"/>` +
    `<rect x="${x + w * 0.2}" y="${y + h * 0.25}" width="${w * 0.6}" height="${h * 0.75}" fill="${P.desk}"/>` +
    Array.from({ length: 8 }, (_, i) => `<rect x="${x + w * 0.24 + (i % 4) * w * 0.14}" y="${y + h * 0.35 + Math.floor(i / 4) * h * 0.25}" width="${w * 0.08}" height="${h * 0.14}" fill="${P.white}" opacity="0.8"/>`).join('') +
    `<rect x="${x + w * 0.46}" y="${y + h * 0.78}" width="${w * 0.08}" height="${h * 0.22}" fill="${P.deskDark}"/>`;
  const webinar = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#2B2440"/>` +
    `<rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="${h * 0.58}" rx="8" fill="#3B2F8F"/>` +
    `<circle cx="${x + w * 0.7}" cy="${y + h * 0.3}" r="${h * 0.12}" fill="#8E82F0"/><path d="M${x + w * 0.7 - h * 0.2} ${y + 16 + h * 0.58} c0 -${h * 0.2} ${h * 0.4} -${h * 0.2} ${h * 0.4} 0 z" fill="#8E82F0"/>` +
    `<g transform="translate(${x + w * 0.32} ${y + h * 0.33})"><circle r="${h * 0.12}" fill="${P.white}"/><path d="M-${h * 0.04} -${h * 0.06} l${h * 0.1} ${h * 0.06} l-${h * 0.1} ${h * 0.06} z" fill="#2B2440"/></g>` +
    bars(x + 24, y + h * 0.72, [w * 0.7, w * 0.4], 30, 12, '#8E82F0');
  const offer = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${P.white}" stroke="${P.wall2}" stroke-width="3"/>` +
    [0, 1, 2].map(i => `<rect x="${x + 20 + i * (w - 40) / 3}" y="${y + 20}" width="${(w - 40) / 3 - 12}" height="${h * 0.45}" rx="8" fill="${[P.orange, P.teal, P.purple][i]}" opacity="0.8"/>`).join('') +
    bars(x + 20, y + h * 0.62, [w * 0.7, w * 0.5], 28, 12);
  const header = (w: number) => `<rect width="${w}" height="80" fill="${P.white}"/><rect y="78" width="${w}" height="3" fill="${P.wall2}"/>` +
    `<g transform="translate(60 40)"><circle r="24" fill="${P.green}"/><path d="M-10 6 q10 -26 20 0" fill="none" stroke="${P.white}" stroke-width="5"/></g>` +
    [0, 1, 2, 3].map(i => `<rect x="${w - 420 + i * 95}" y="34" width="70" height="12" rx="6" fill="${i === 2 ? P.purple : P.grey}"/>`).join('');
  if (!portrait) {
    const w = 1600, h = 1000;
    const L = { bud: [128, 100, 1344, 160], p1: [128, 300, 416, 340], p2: [608, 300, 416, 340], web: [1120, 300, 384, 300], off: [1120, 640, 384, 180], stop: [0, 850, w, 150] };
    return {
      w, h,
      svg: `<rect width="${w}" height="${h}" fill="#F7F8FC"/>` + header(w) +
        building(L.bud[0], L.bud[1], L.bud[2], L.bud[3]) + person(L.p1[0], L.p1[1], L.p1[2], L.p1[3], P.teal, '#2E2A33') + person(L.p2[0], L.p2[1], L.p2[2], L.p2[3], P.orange, '#5A3A22') +
        webinar(L.web[0], L.web[1], L.web[2], L.web[3]) + offer(L.off[0], L.off[1], L.off[2], L.off[3]) +
        `<rect x="0" y="850" width="${w}" height="150" fill="#2B2440"/>` + bars(128, 880, [620], 0, 14, '#8E82F0') + bars(960, 880, [420], 0, 14, '#8E82F0') + bars(1120, 940, [300], 0, 14, '#8E82F0'),
      parts: {
        'zdjecie-budynku': { x: 128, y: 100, w: 1344, h: 160 }, 'zespol-pawel': { x: 128, y: 300, w: 416, h: 340 }, 'kierownik-sprzedazy': { x: 608, y: 300, w: 416, h: 340 },
        webinar: { x: 1120, y: 300, w: 384, h: 300 }, oferta: { x: 1120, y: 640, w: 384, h: 180 },
        'numery-wewn': { x: 128, y: 860, w: 800, h: 70 }, 'adres-firmy': { x: 960, y: 860, w: 512, h: 60 }, godziny: { x: 1120, y: 925, w: 352, h: 55 },
      },
    };
  }
  const w = 900, h = 2400;
  return {
    w, h,
    svg: `<rect width="${w}" height="${h}" fill="#F7F8FC"/>` + header(w) +
      building(50, 110, 800, 280) + person(50, 430, 800, 420, P.teal, '#2E2A33') + person(50, 890, 800, 420, P.orange, '#5A3A22') +
      webinar(50, 1350, 800, 420) + offer(50, 1810, 800, 250) +
      `<rect x="0" y="2100" width="${w}" height="300" fill="#2B2440"/>` + bars(50, 2140, [700], 0, 16, '#8E82F0') + bars(50, 2230, [520], 0, 16, '#8E82F0') + bars(50, 2320, [400], 0, 16, '#8E82F0'),
    parts: {
      'zdjecie-budynku': { x: 50, y: 110, w: 800, h: 280 }, 'zespol-pawel': { x: 50, y: 430, w: 800, h: 420 }, 'kierownik-sprzedazy': { x: 50, y: 890, w: 800, h: 420 },
      webinar: { x: 50, y: 1350, w: 800, h: 420 }, oferta: { x: 50, y: 1810, w: 800, h: 250 },
      'numery-wewn': { x: 50, y: 2120, w: 800, h: 70 }, 'adres-firmy': { x: 50, y: 2210, w: 800, h: 70 }, godziny: { x: 50, y: 2300, w: 800, h: 70 },
    },
  };
};

/** Kadr webinaru: slajd (tytuł w textLayer) + sylwetka prelegenta + pasek odtwarzacza. */
export const webinarFrame: PropFn<{ portrait?: boolean }> = ({ portrait = false }) => {
  const w = portrait ? 900 : 1600, h = portrait ? 1600 : 900;
  const slide = portrait ? [60, 120, 780, 560] : [80, 80, 960, 600];
  const spk = portrait ? [450, 1160] : [1300, 520];
  return {
    w, h,
    svg: `<rect width="${w}" height="${h}" rx="24" fill="#1E1840"/>` +
      `<rect x="${slide[0]}" y="${slide[1]}" width="${slide[2]}" height="${slide[3]}" rx="12" fill="${P.white}"/>` +
      `<rect x="${slide[0]}" y="${slide[1]}" width="${slide[2]}" height="${slide[3] * 0.22}" rx="12" fill="${P.purple}"/>` +
      `<g transform="translate(${slide[0] + slide[2] * 0.2} ${slide[1] + slide[3] * 0.62})">${remoteIcon(slide[3] * 0.4)}</g>` +
      bars(slide[0] + slide[2] * 0.42, slide[1] + slide[3] * 0.4, [slide[2] * 0.45, slide[2] * 0.38, slide[2] * 0.42, slide[2] * 0.3], slide[3] * 0.1, slide[3] * 0.035) +
      `<circle cx="${spk[0]}" cy="${spk[1] - 170}" r="90" fill="#8E82F0"/><path d="M${spk[0] - 190} ${spk[1] + 160} c0 -200 380 -200 380 0 z" fill="#8E82F0"/>` +
      `<rect x="${spk[0] - 16}" y="${spk[1] - 60}" width="32" height="60" rx="10" fill="#443B63"/>` +
      `<rect x="0" y="${h - 90}" width="${w}" height="90" rx="0" fill="#141029"/>` +
      `<path d="M50 ${h - 62} l30 17 l-30 17 z" fill="${P.white}"/>` +
      `<rect x="120" y="${h - 50}" width="${w - 260}" height="10" rx="5" fill="#443B63"/><rect x="120" y="${h - 50}" width="${(w - 260) * 0.35}" height="10" rx="5" fill="${P.red}"/>`,
    parts: { 'slot-tytul-slajdu': { x: slide[0] + 30, y: slide[1] + 20, w: slide[2] - 60, h: slide[3] * 0.22 - 40 } },
  };
};

export const HELPDESK_PROPS = { mfaListZoom, callLogZoom, desktopRemoteIcon, remoteToolWindow, recorderTop, headphonesTop, transcriptPagesTop, highlighterTop, adminConsoleWindow, callCompareTop, intranetSheet, teamWebsite, webinarFrame, phoneLying, stickyLying, noCodePoster, monitorRemote, phoneFaceUp, phoneHomeTiles, incomingCallScreen, avatarBust, trophyHelpdesk };
