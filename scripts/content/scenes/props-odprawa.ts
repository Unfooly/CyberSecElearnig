/**
 * Klocki odprawy (BRIEFING) — widok z góry na biurko detektywa.
 * Te same zasady co props.ts: lokalny układ (0,0)→(w,h), paleta P, bez zewnętrznych zasobów.
 * Części `slot-*` to miejsca, w które player wstawia dane z treści/gracza (imię, numer, zadania).
 */
import { P } from './palette.js';
import { registeredProp } from './prop-registry.js';
import type { PropFn } from './types.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const t = (x: number, y: number, s: unknown, size: number, o: { fill?: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end'; spacing?: number; opacity?: number } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill ?? P.ink}"${o.bold ? ' font-weight="bold"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}>${esc(s)}</text>`;

const shadow = (w: number, h: number, rx: number, dx = 10, dy = 14) =>
  `<rect x="${dx}" y="${dy}" width="${w}" height="${h}" rx="${rx}" fill="${P.ink}" opacity="0.18"/>`;

const bars = (x: number, y: number, widths: number[], gap = 18, h = 7, fill = P.grey) =>
  widths.map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`).join('');

const FOLDER = '#C9C1FA';
const FOLDER_EDGE = '#A99CF2';
const LEATHER = '#3B3354';
const COFFEE = '#6B4A2E';
const NEWSPRINT = '#FAF8F2';

/* ---------- tło: słoje drewna ---------- */

export const woodGrain: PropFn<{ w?: number; h?: number }> = ({ w = 1600, h = 900 }) => {
  let g = '';
  for (let i = 0; i < 16; i++) {
    const y = 30 + i * (h / 16) + (i % 3) * 7;
    const a = 6 + (i % 4) * 3;
    g += `<path d="M0 ${y} C ${w * 0.25} ${y - a}, ${w * 0.5} ${y + a}, ${w * 0.75} ${y - a / 2} S ${w} ${y + a / 2}, ${w} ${y}" fill="none" stroke="${P.deskDark}" stroke-width="${i % 2 ? 2 : 3}" opacity="0.28"/>`;
  }
  g += `<ellipse cx="${w * 0.72}" cy="${h * 0.3}" rx="46" ry="14" fill="none" stroke="${P.deskDark}" stroke-width="3" opacity="0.3"/>`;
  g += `<ellipse cx="${w * 0.72}" cy="${h * 0.3}" rx="24" ry="6" fill="none" stroke="${P.deskDark}" stroke-width="2" opacity="0.3"/>`;
  return { w, h, svg: g };
};

/* ---------- telefon z góry ---------- */

const handset = (cx: number, cy: number, rot: number) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot})"><path d="M-14 4 a14 14 0 0 1 28 0" fill="none" stroke="${P.white}" stroke-width="7" stroke-linecap="round"/><rect x="-19" y="1" width="11" height="8" rx="3" fill="${P.white}"/><rect x="8" y="1" width="11" height="8" rx="3" fill="${P.white}"/></g>`;

export const phoneTop: PropFn<{ state?: 'ringing' | 'call' | 'idle'; caller?: string; role?: string; initials?: string; timer?: string; animated?: boolean }> = ({
  state = 'ringing', animated = true, caller = 'Komisarz A. Wolski', role = 'Wydział Cyberbezpieczeństwa', initials = 'AW', timer = '00:12',
}) => {
  const w = 240, h = 480;
  const avatar = `<circle cx="120" cy="170" r="50" fill="#EEEBFF"/>` + t(120, 184, initials, 36, { anchor: 'middle', bold: true, fill: P.purple });
  let screen = '';
  if (state === 'ringing') {
    screen =
      `<rect x="12" y="14" width="216" height="452" rx="26" fill="${P.purpleDark}"/>` +
      `<rect x="12" y="14" width="216" height="240" rx="26" fill="${P.purple}"/>` +
      t(120, 64, 'Połączenie przychodzące', 13, { anchor: 'middle', fill: P.white, opacity: 0.85 }) + avatar +
      t(120, 256, caller, 17, { anchor: 'middle', bold: true, fill: P.white }) +
      t(120, 278, role, 11, { anchor: 'middle', fill: P.white, opacity: 0.8 }) +
      `<circle cx="66" cy="396" r="30" fill="${P.red}"/>${handset(66, 396, 135)}` +
      `<g${animated ? ' class="a-grow"' : ''}><circle cx="174" cy="396" r="30" fill="${P.green}"/>${handset(174, 400, 0)}</g>` +
      t(66, 446, 'Odrzuć', 11, { anchor: 'middle', fill: P.white, opacity: 0.85 }) + t(174, 446, 'Odbierz', 11, { anchor: 'middle', fill: P.white, opacity: 0.85 });
  } else if (state === 'call') {
    const btn = (cx: number, cy: number, label: string) =>
      `<circle cx="${cx}" cy="${cy}" r="24" fill="${P.white}" opacity="0.16"/>` + t(cx, cy + 40, label, 10, { anchor: 'middle', fill: P.white, opacity: 0.8 });
    screen =
      `<rect x="12" y="14" width="216" height="452" rx="26" fill="${P.ink}"/>` +
      t(120, 64, timer, 15, { anchor: 'middle', fill: P.white, opacity: 0.85 }) + avatar +
      t(120, 256, caller, 17, { anchor: 'middle', bold: true, fill: P.white }) +
      t(120, 278, role, 11, { anchor: 'middle', fill: P.white, opacity: 0.75 }) +
      btn(60, 330, 'wycisz') + btn(120, 330, 'klawiatura') + btn(180, 330, 'głośnik') +
      `<rect x="54" y="322" width="12" height="16" rx="6" fill="${P.white}"/>` +
      `<g fill="${P.white}">${[0, 1, 2].map(r => [0, 1, 2].map(c => `<circle cx="${112 + c * 8}" cy="${322 + r * 8}" r="2.4"/>`).join('')).join('')}</g>` +
      `<path d="M172 324 h6 l7 -6 v24 l-7 -6 h-6 z" fill="${P.white}"/>` +
      `<circle cx="120" cy="420" r="30" fill="${P.red}"/>${handset(120, 420, 135)}`;
  } else {
    screen = `<rect x="12" y="14" width="216" height="452" rx="26" fill="${P.ink}"/>` + t(120, 120, '9:40', 44, { anchor: 'middle', fill: P.white, opacity: 0.9 }) + t(120, 146, 'wtorek', 13, { anchor: 'middle', fill: P.white, opacity: 0.7 });
  }
  const rings = state === 'ringing'
    ? [0, 1].map(i => {
        const d = 30 + i * 26;
        const cls = animated ? ` class="a-wave${i ? ' d1' : ''}"` : ' opacity="0.8"';
        return `<path${cls} d="M${-d + 10} ${h / 2 - 50 - i * 14} a${60 + i * 26} ${60 + i * 26} 0 0 0 0 ${100 + i * 28}" fill="none" stroke="${P.purple}" stroke-width="7" stroke-linecap="round"/>` +
          `<path${cls} d="M${w + d - 10} ${h / 2 - 50 - i * 14} a${60 + i * 26} ${60 + i * 26} 0 0 1 0 ${100 + i * 28}" fill="none" stroke="${P.purple}" stroke-width="7" stroke-linecap="round"/>`;
      }).join('')
    : '';
  const ringCls = state === 'ringing' && animated ? ' class="a-ring"' : '';
  return {
    w, h,
    svg: rings + `<g${ringCls}>${shadow(w, h, 36)}<rect width="${w}" height="${h}" rx="36" fill="${P.ink}"/>${screen}<rect x="92" y="22" width="56" height="10" rx="5" fill="${P.ink}"/></g>`,
    // endCall / answer: czerwona i zielona słuchawka na ekranie - osobne hotspoty kroków odprawy (Rozłącz, Odbierz).
    parts: { screen: { x: 12, y: 14, w: 216, h: 452 }, endCall: { x: 84, y: 384, w: 72, h: 72 }, answer: { x: 138, y: 360, w: 72, h: 72 } },
  };
};

/* ---------- drobiazgi na biurku ---------- */

export const mugTop: PropFn<{ color?: string }> = ({ color = P.teal }) => ({
  w: 150, h: 120,
  svg:
    `<circle cx="66" cy="68" r="56" fill="${P.ink}" opacity="0.15"/>` +
    `<rect x="100" y="44" width="46" height="26" rx="13" fill="${color}"/>` +
    `<circle cx="60" cy="60" r="56" fill="${color}"/><circle cx="60" cy="60" r="44" fill="${COFFEE}"/>` +
    `<ellipse cx="46" cy="46" rx="14" ry="7" fill="${P.white}" opacity="0.25" transform="rotate(-30 46 46)"/>` +
    `<g class="a-shimmer"><path d="M44 70 q10 -10 22 -2 q10 8 20 -4" fill="none" stroke="${P.white}" stroke-width="4" stroke-linecap="round" opacity="0.35"/></g>`,
});

export const coffeeRing: PropFn<Record<string, never>> = () => ({
  w: 110, h: 110,
  svg: `<circle cx="55" cy="55" r="46" fill="none" stroke="${COFFEE}" stroke-width="6" opacity="0.18"/><path d="M20 40 a46 46 0 0 1 30 -30" fill="none" stroke="${COFFEE}" stroke-width="9" opacity="0.12"/>`,
});

// Domyślne dopiski neutralne: detektyw o 9:40 nie zna jeszcze sprawy, a telefon „informatyka” był o 9:05 (oś czasu modułu 1, D-084).
export const notepadTop: PropFn<{ lines?: string[] }> = ({ lines = ['raport — poniedziałek', 'szkolenie IT 14:00', 'oddać lupę'] }) => {
  const w = 250, h = 320;
  let spiral = '';
  for (let i = 0; i < 9; i++) spiral += `<circle cx="${30 + i * 24}" cy="14" r="8" fill="none" stroke="${P.greyDark}" stroke-width="4"/>`;
  return {
    w, h,
    svg:
      shadow(w, h, 8) + `<rect width="${w}" height="${h}" rx="8" fill="${P.white}"/>` + spiral +
      Array.from({ length: 10 }, (_, i) => `<line x1="18" y1="${60 + i * 26}" x2="${w - 18}" y2="${60 + i * 26}" stroke="${P.sky}" stroke-width="2"/>`).join('') +
      `<line x1="44" y1="30" x2="44" y2="${h - 10}" stroke="#F4B6B8" stroke-width="2"/>` +
      lines.slice(0, 4).map((l, i) => t(54, 81 + i * 52, l, 17, { fill: P.purpleDark })).join('') +
      `<path d="M54 ${96} q60 10 120 -2" fill="none" stroke="${P.red}" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="200" cy="${240}" r="22" fill="none" stroke="${P.red}" stroke-width="3"/>` + t(200, 248, '?', 24, { anchor: 'middle', bold: true, fill: P.red }),
  };
};

export const penTop: PropFn<{ color?: string }> = ({ color = P.purple }) => ({
  w: 240, h: 24,
  svg: `<rect x="6" y="6" width="220" height="16" rx="8" fill="${P.ink}" opacity="0.15"/><rect width="200" height="16" rx="8" fill="${color}"/><path d="M200 0 l36 8 l-36 8 z" fill="${P.grey}"/><path d="M226 6 l10 2 l-10 2 z" fill="${P.ink}"/><rect x="24" y="-4" width="70" height="6" rx="3" fill="${P.greyDark}"/>`,
});

export const glassesTop: PropFn<Record<string, never>> = () => ({
  w: 230, h: 110,
  svg:
    `<g opacity="0.15" transform="translate(6 8)"><circle cx="55" cy="55" r="42" fill="${P.ink}"/><circle cx="175" cy="55" r="42" fill="${P.ink}"/></g>` +
    `<circle cx="55" cy="55" r="42" fill="${P.sky}" opacity="0.55" stroke="${P.ink}" stroke-width="7"/>` +
    `<circle cx="175" cy="55" r="42" fill="${P.sky}" opacity="0.55" stroke="${P.ink}" stroke-width="7"/>` +
    `<path d="M97 50 q18 -14 36 0" fill="none" stroke="${P.ink}" stroke-width="7"/>` +
    `<path d="M14 40 l-14 -34 M216 40 l14 -34" stroke="${P.ink}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M36 36 q10 -10 22 -8 M156 36 q10 -10 22 -8" stroke="${P.white}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`,
});

export const keysTop: PropFn<{ tag?: string }> = ({ tag = 'BIURO' }) => ({
  w: 220, h: 150,
  svg:
    `<circle cx="60" cy="60" r="34" fill="none" stroke="${P.greyDark}" stroke-width="7"/>` +
    `<g transform="rotate(20 60 60)"><rect x="90" y="52" width="110" height="16" rx="5" fill="${P.grey}"/><circle cx="96" cy="60" r="20" fill="${P.grey}"/><circle cx="96" cy="60" r="7" fill="${P.desk}"/><path d="M160 68 v12 h10 v-12 M180 68 v8 h10 v-8" fill="${P.grey}"/></g>` +
    `<g transform="rotate(-35 60 60)"><rect x="-10" y="100" width="80" height="44" rx="8" fill="${P.purple}"/>${t(30, 128, tag, 14, { anchor: 'middle', bold: true, fill: P.white })}</g>`,
});

export const magnifier: PropFn<Record<string, never>> = () => ({
  w: 240, h: 240,
  svg:
    `<g transform="translate(8 10)" opacity="0.15"><circle cx="90" cy="90" r="74" fill="${P.ink}"/><rect x="150" y="140" width="90" height="30" rx="14" transform="rotate(45 150 140)" fill="${P.ink}"/></g>` +
    `<rect x="148" y="136" width="100" height="32" rx="15" transform="rotate(45 148 136)" fill="${LEATHER}"/>` +
    `<circle cx="90" cy="90" r="74" fill="${P.sky}" opacity="0.5" stroke="${P.greyDark}" stroke-width="12"/>` +
    `<path d="M50 60 q20 -28 52 -26" fill="none" stroke="${P.white}" stroke-width="8" stroke-linecap="round" opacity="0.8"/>`,
});

export const laptopTopClosed: PropFn<Record<string, never>> = () => ({
  w: 460, h: 310,
  svg:
    shadow(460, 310, 18) + `<rect width="460" height="310" rx="18" fill="#A7AAC4"/><rect x="10" y="10" width="440" height="290" rx="12" fill="#B8BAD0"/>` +
    `<circle cx="230" cy="155" r="30" fill="${P.white}" opacity="0.35"/>` +
    `<g transform="rotate(-10 360 90)"><rect x="320" y="60" width="90" height="60" rx="10" fill="${P.purple}"/><rect x="351" y="80" width="28" height="22" rx="4" fill="${P.white}"/><path d="M356 80 v-7 a9 9 0 0 1 18 0 v7" fill="none" stroke="${P.white}" stroke-width="4"/></g>` +
    `<g transform="rotate(8 90 240)"><circle cx="90" cy="240" r="30" fill="${P.yellow}"/>${t(90, 248, ':)', 22, { anchor: 'middle', bold: true })}</g>`,
});

export const newspaper: PropFn<{ title?: string; headline?: string[] }> = ({ title = 'GAZETA MIEJSKA', headline = ['Fala oszustw', '„na pracownika banku”'] }) => {
  const w = 340, h = 420;
  return {
    w, h,
    svg:
      shadow(w, h, 4) + `<rect width="${w}" height="${h}" rx="4" fill="${NEWSPRINT}"/><line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="${P.grey}" stroke-width="2" opacity="0.5"/>` +
      t(w / 2, 50, title, 26, { anchor: 'middle', bold: true, spacing: 2 }) +
      `<line x1="20" y1="64" x2="${w - 20}" y2="64" stroke="${P.ink}" stroke-width="3"/>` +
      headline.slice(0, 2).map((l, i) => t(24, 104 + i * 30, l, 24, { bold: true })).join('') +
      `<rect x="24" y="160" width="140" height="100" rx="4" fill="${P.wall2}"/><path d="M40 244 l36 -40 l28 26 l20 -18 l30 32 z" fill="${P.grey}"/>` +
      bars(180, 164, [130, 120, 130, 100, 126, 90], 16, 6) + bars(24, 282, [292, 280, 292, 260, 292, 240, 292, 200], 16, 6),
  };
};

/* ---------- teczka ---------- */

/** `stampDrop` (D-090): stempel "spada" przy pojawieniu się sceny (jednorazowa animacja a-stamp z compose.ts). */
export const caseFolderClosed: PropFn<{ caseNo?: string; stamp?: string; stampDrop?: boolean }> = ({ caseNo = 'CS/2026/0915', stamp = 'PRIORYTET', stampDrop = false }) => {
  const w = 620, h = 440;
  const stampSvg = `<rect x="340" y="270" width="230" height="74" rx="10" fill="none" stroke="${P.red}" stroke-width="6"/>${t(455, 320, stamp, 30, { anchor: 'middle', bold: true, fill: P.red, spacing: 2 })}`;
  return {
    w, h,
    svg:
      shadow(w, h, 14, 14, 18) +
      `<rect x="16" y="-14" width="${w - 30}" height="${h}" rx="6" fill="${P.white}" transform="rotate(1.5 ${w / 2} ${h / 2})"/>` +
      `<rect x="10" y="-6" width="${w - 20}" height="${h}" rx="6" fill="#F4F4F8" transform="rotate(-1 ${w / 2} ${h / 2})"/>` +
      `<rect width="${w}" height="${h}" rx="14" fill="${FOLDER}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      `<path d="M30 0 h180 l20 -26 h140 l20 26" fill="${FOLDER}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      `<rect x="70" y="80" width="340" height="120" rx="8" fill="${P.white}"/>` +
      t(90, 118, 'AKTA SPRAWY', 20, { bold: true, spacing: 3, fill: P.greyDark }) +
      t(90, 164, caseNo, 34, { bold: true }) +
      bars(90, 180, [220], 14, 5) +
      // Animacja na wewnętrznej grupie: transform z CSS zastąpiłby atrybut transform (obrót stempla) na tej samej grupie.
      `<g transform="rotate(-10 440 310)">${stampDrop ? `<g class="a-stamp">${stampSvg}</g>` : stampSvg}</g>` +
      `<rect x="${w - 110}" y="0" width="16" height="${h}" fill="${P.ink}" opacity="0.85"/>` +
      `<rect x="70" y="${h - 90}" width="200" height="14" rx="7" fill="${FOLDER_EDGE}"/>`,
    parts: { cover: { x: 0, y: -26, w, h: h + 26 } },
  };
};

const field = (x: number, y: number, k: string, v: string, vBold = false) =>
  t(x, y, k.toUpperCase(), 13, { bold: true, fill: P.greyDark, spacing: 1 }) + t(x, y + 26, v, 20, { bold: vBold });

export const caseFolderOpen: PropFn<{
  caseNo?: string; title?: string; victim?: string; victimRole?: string; loss?: string; when?: string; reporter?: string; stamp?: string;
}> = ({
  caseNo = 'CS/2026/0915', title = 'Nieautoryzowany przelew', victim = 'Anna Kowalska', victimRole = 'księgowa · Unfooly Sp. z o.o.',
  loss = '14 000,00 PLN', when = 'wtorek, 9:12', reporter = 'Marek Zieliński, dział IT', stamp = 'PRIORYTET',
}) => {
  const w = 1340, h = 780;
  const pw = 620, ph = 720;
  const L = 30, R = w - 30 - pw, top = 30;
  return {
    w, h,
    svg:
      shadow(w, h, 18, 16, 20) +
      `<rect width="${w}" height="${h}" rx="18" fill="${FOLDER}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      `<line x1="${w / 2}" y1="10" x2="${w / 2}" y2="${h - 10}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      /* lewa kartka: karta sprawy */
      `<rect x="${L + 6}" y="${top + 8}" width="${pw}" height="${ph}" rx="6" fill="${P.ink}" opacity="0.12"/>` +
      `<rect x="${L}" y="${top}" width="${pw}" height="${ph}" rx="6" fill="${P.white}"/>` +
      t(L + 40, top + 62, 'AKTA SPRAWY', 16, { bold: true, spacing: 3, fill: P.greyDark }) +
      t(L + 40, top + 104, caseNo, 36, { bold: true }) +
      t(L + 40, top + 146, title, 26, { bold: true, fill: P.purpleDark }) +
      `<line x1="${L + 40}" y1="${top + 172}" x2="${L + pw - 40}" y2="${top + 172}" stroke="${P.grey}" stroke-width="2"/>` +
      field(L + 40, top + 214, 'Poszkodowana', victim, true) + t(L + 40, top + 262, victimRole, 16, { fill: P.greyDark }) +
      field(L + 40, top + 318, 'Strata', loss, true) +
      field(L + 330, top + 318, 'Kiedy', when) +
      field(L + 40, top + 408, 'Zgłosił', reporter) +
      `<g transform="rotate(-9 ${L + 440} ${top + 560})"><rect x="${L + 320}" y="${top + 520}" width="240" height="76" rx="10" fill="none" stroke="${P.red}" stroke-width="6"/>${t(L + 440, top + 571, stamp, 30, { anchor: 'middle', bold: true, fill: P.red, spacing: 2 })}</g>` +
      /* polaroid biura */
      `<g transform="rotate(-6 ${L + 150} ${top + 590})"><rect x="${L + 50}" y="${top + 490}" width="200" height="200" rx="4" fill="${P.white}" stroke="${P.grey}" stroke-width="2"/><rect x="${L + 64}" y="${top + 504}" width="172" height="140" fill="${P.wall}"/>` +
      `<rect x="${L + 80}" y="${top + 590}" width="140" height="10" fill="${P.desk}"/><rect x="${L + 120}" y="${top + 540}" width="60" height="44" rx="4" fill="${P.ink}"/><rect x="${L + 126}" y="${top + 546}" width="48" height="32" fill="${P.sky}"/><rect x="${L + 186}" y="${top + 548}" width="14" height="12" fill="${P.yellow}"/>` +
      t(L + 150, top + 672, 'biuro A.K.', 15, { anchor: 'middle', fill: P.greyDark }) + `</g>` +
      /* spinacz */
      `<path d="M${L + 520} ${top - 18} v70 a14 14 0 0 0 28 0 v-60 a8 8 0 0 0 -16 0 v52" fill="none" stroke="${P.greyDark}" stroke-width="5" stroke-linecap="round"/>` +
      /* prawa kartka: zadania (tekst wstawia player w slot-zadania) */
      `<rect x="${R + 6}" y="${top + 8}" width="${pw}" height="${ph}" rx="6" fill="${P.ink}" opacity="0.12"/>` +
      `<rect x="${R}" y="${top}" width="${pw}" height="${ph}" rx="6" fill="${P.white}"/>` +
      t(R + 40, top + 62, 'ZADANIA', 16, { bold: true, spacing: 3, fill: P.greyDark }) +
      `<line x1="${R + 40}" y1="${top + 84}" x2="${R + pw - 40}" y2="${top + 84}" stroke="${P.grey}" stroke-width="2"/>` +
      Array.from({ length: 12 }, (_, i) => `<line x1="${R + 40}" y1="${top + 150 + i * 44}" x2="${R + pw - 40}" y2="${top + 150 + i * 44}" stroke="${P.sky}" stroke-width="2"/>`).join('') +
      `<g transform="rotate(4 ${R + 480} ${top + 640})"><rect x="${R + 380}" y="${top + 600}" width="200" height="70" rx="4" fill="${P.yellow}"/>${t(R + 480, top + 644, 'dowody → notatnik', 17, { anchor: 'middle', bold: true, fill: P.purpleDark })}</g>`,
    parts: {
      'slot-zadania': { x: R + 40, y: top + 110, w: pw - 80, h: 460 },
    },
  };
};

/* ---------- legitymacja ---------- */

export const badgeWallet: PropFn<{ unit?: string }> = ({ unit = 'WYDZIAŁ CYBERBEZPIECZEŃSTWA' }) => {
  const w = 1100, h = 660;
  const half = w / 2;
  const cardX = half + 40, cardY = 70, cardW = half - 80, cardH = h - 140;
  let stitch = `<rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="26" fill="none" stroke="${P.yellowDark}" stroke-width="3" stroke-dasharray="12 9" opacity="0.7"/>`;
  stitch += `<line x1="${half}" y1="20" x2="${half}" y2="${h - 20}" stroke="${P.ink}" stroke-width="6" opacity="0.4"/>`;
  /* odznaka: tarcza z kłódką */
  const bx = half / 2, by = h / 2 - 10;
  const shield = `M${bx} ${by - 190} L${bx + 150} ${by - 130} V${by + 10} C${bx + 150} ${by + 120}, ${bx + 70} ${by + 180}, ${bx} ${by + 210} C${bx - 70} ${by + 180}, ${bx - 150} ${by + 120}, ${bx - 150} ${by + 10} V${by - 130} Z`;
  const badge =
    `<path d="${shield}" transform="translate(8 12)" fill="${P.ink}" opacity="0.3"/>` +
    `<path d="${shield}" fill="${P.yellowDark}"/>` +
    `<path d="${shield}" transform="translate(${bx} ${by}) scale(0.86) translate(${-bx} ${-by})" fill="${P.yellow}"/>` +
    `<circle cx="${bx}" cy="${by - 10}" r="78" fill="${P.purple}"/><circle cx="${bx}" cy="${by - 10}" r="66" fill="none" stroke="${P.white}" stroke-width="3" opacity="0.6"/>` +
    `<rect x="${bx - 30}" y="${by - 16}" width="60" height="48" rx="8" fill="${P.white}"/>` +
    `<path d="M${bx - 19} ${by - 16} v-14 a19 19 0 0 1 38 0 v14" fill="none" stroke="${P.white}" stroke-width="9"/>` +
    `<circle cx="${bx}" cy="${by + 4}" r="7" fill="${P.purple}"/><rect x="${bx - 3}" y="${by + 6}" width="6" height="14" fill="${P.purple}"/>` +
    t(bx, by + 110, unit.split(' ')[0] ?? '', 16, { anchor: 'middle', bold: true, fill: P.purpleDark, spacing: 2 }) +
    t(bx, by + 132, unit.split(' ').slice(1).join(' '), 13, { anchor: 'middle', bold: true, fill: P.purpleDark, spacing: 1 }) +
    [-1, 1].map(s => `<path d="M${bx + s * 100} ${by - 100} l${s * 8} 18 l${s * -8} 18 l${s * -8} -18 z" fill="${P.white}" opacity="0.7"/>`).join('');
  const card =
    `<rect x="${cardX + 6}" y="${cardY + 8}" width="${cardW}" height="${cardH}" rx="18" fill="${P.ink}" opacity="0.3"/>` +
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="18" fill="${P.white}"/>` +
    `<path d="M${cardX} ${cardY + 18} a18 18 0 0 1 18 -18 h${cardW - 36} a18 18 0 0 1 18 18 v58 h-${cardW} z" fill="${P.purple}"/>` +
    t(cardX + 28, cardY + 48, 'LEGITYMACJA SŁUŻBOWA', 20, { bold: true, fill: P.white, spacing: 2 }) +
    `<rect x="${cardX + 28}" y="${cardY + 110}" width="150" height="190" rx="10" fill="#EEEBFF"/>` +
    t(cardX + 210, cardY + 128, 'IMIĘ I NAZWISKO', 12, { bold: true, fill: P.greyDark, spacing: 1 }) +
    `<line x1="${cardX + 210}" y1="${cardY + 180}" x2="${cardX + cardW - 28}" y2="${cardY + 180}" stroke="${P.grey}" stroke-width="2"/>` +
    t(cardX + 210, cardY + 214, 'NR LEGITYMACJI', 12, { bold: true, fill: P.greyDark, spacing: 1 }) +
    `<line x1="${cardX + 210}" y1="${cardY + 262}" x2="${cardX + cardW - 28}" y2="${cardY + 262}" stroke="${P.grey}" stroke-width="2"/>` +
    t(cardX + 28, cardY + 346, 'STOPIEŃ', 12, { bold: true, fill: P.greyDark, spacing: 1 }) + t(cardX + 28, cardY + 372, 'detektyw', 20, { bold: true }) +
    t(cardX + 210, cardY + 346, 'JEDNOSTKA', 12, { bold: true, fill: P.greyDark, spacing: 1 }) + t(cardX + 210, cardY + 372, 'Wydz. Cyberbezpieczeństwa', 18, { bold: true }) +
    `<path d="M${cardX + 30} ${cardY + 450} q20 -30 40 0 t40 -6 q14 -18 30 4" fill="none" stroke="${P.purpleDark}" stroke-width="3" stroke-linecap="round"/>` +
    t(cardX + 30, cardY + 478, 'podpis wystawcy', 11, { fill: P.greyDark }) +
    `<g class="a-shimmer"><circle cx="${cardX + cardW - 80}" cy="${cardY + 440}" r="44" fill="${P.sky}" opacity="0.8"/><circle cx="${cardX + cardW - 80}" cy="${cardY + 440}" r="30" fill="#EEEBFF" opacity="0.9"/><circle cx="${cardX + cardW - 80}" cy="${cardY + 440}" r="16" fill="${P.sun}"/></g>`;
  return {
    w, h,
    svg:
      `<rect x="14" y="18" width="${w}" height="${h}" rx="34" fill="${P.ink}" opacity="0.22"/>` +
      `<rect width="${w}" height="${h}" rx="34" fill="${LEATHER}"/>` + stitch + badge + card,
    parts: {
      'slot-zdjecie': { x: cardX + 28, y: cardY + 110, w: 150, h: 190 },
      'slot-imie': { x: cardX + 210, y: cardY + 138, w: cardW - 238, h: 40 },
      'slot-numer': { x: cardX + 210, y: cardY + 222, w: cardW - 238, h: 40 },
    },
  };
};

export const ODPRAWA_PROPS = {
  woodGrain, phoneTop, mugTop, coffeeRing, notepadTop, penTop, glassesTop, keysTop, magnifier,
  laptopTopClosed, newspaper, caseFolderClosed, caseFolderOpen, badgeWallet,
};

/* ---------- zamknięcie sprawy (feat/case-closed, D-089) ---------- */

export const reportFolderOpen: PropFn<{ caseNo?: string; title?: string }> = ({ caseNo = 'CS/2026/0915', title = 'Nieautoryzowany przelew' }) => {
  const w = 1340, h = 780, pw = 620, ph = 720, L = 30, R = w - 30 - pw, top = 30;
  const statBox = (x: number, y: number, label: string) =>
    `<rect x="${x}" y="${y}" width="170" height="96" rx="8" fill="#F6F6F4"/>` + t(x + 16, y + 28, label, 13, { bold: true, fill: P.greyDark, spacing: 1 });
  return {
    w, h,
    svg:
      shadow(w, h, 18, 16, 20) +
      `<rect width="${w}" height="${h}" rx="18" fill="${FOLDER}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      `<line x1="${w / 2}" y1="10" x2="${w / 2}" y2="${h - 10}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      /* lewa: raport końcowy */
      `<rect x="${L + 6}" y="${top + 8}" width="${pw}" height="${ph}" rx="6" fill="${P.ink}" opacity="0.12"/>` +
      `<rect x="${L}" y="${top}" width="${pw}" height="${ph}" rx="6" fill="${P.white}"/>` +
      t(L + 40, top + 62, 'RAPORT KOŃCOWY', 16, { bold: true, spacing: 3, fill: P.greyDark }) +
      t(L + 40, top + 104, caseNo, 36, { bold: true }) +
      t(L + 40, top + 146, title, 26, { bold: true, fill: P.purpleDark }) +
      `<line x1="${L + 40}" y1="${top + 172}" x2="${L + pw - 40}" y2="${top + 172}" stroke="${P.grey}" stroke-width="2"/>` +
      statBox(L + 40, top + 200, 'DOWODY') + statBox(L + 225, top + 200, 'CZAS') + statBox(L + 410, top + 200, 'XP') +
      t(L + 40, top + 346, 'WNIOSKI ŚLEDCZEGO', 13, { bold: true, fill: P.greyDark, spacing: 1 }) +
      Array.from({ length: 6 }, (_, i) => `<line x1="${L + 40}" y1="${top + 400 + i * 40}" x2="${L + pw - 40}" y2="${top + 400 + i * 40}" stroke="${P.sky}" stroke-width="2"/>`).join('') +
      t(L + 40, top + 668, 'PODPIS PROWADZĄCEGO', 12, { bold: true, fill: P.greyDark, spacing: 1 }) +
      `<line x1="${L + 250}" y1="${top + 670}" x2="${L + pw - 40}" y2="${top + 670}" stroke="${P.ink}" stroke-width="2" stroke-dasharray="6 6"/>` +
      /* prawa: dowody rzeczowe (miniatury) + miejsce na pieczęć */
      `<rect x="${R + 6}" y="${top + 8}" width="${pw}" height="${ph}" rx="6" fill="${P.ink}" opacity="0.12"/>` +
      `<rect x="${R}" y="${top}" width="${pw}" height="${ph}" rx="6" fill="${P.white}"/>` +
      t(R + 40, top + 62, 'DOWODY RZECZOWE', 16, { bold: true, spacing: 3, fill: P.greyDark }) +
      `<line x1="${R + 40}" y1="${top + 84}" x2="${R + pw - 40}" y2="${top + 84}" stroke="${P.grey}" stroke-width="2"/>` +
      /* woreczki na dowody: siatka 3×3, prawa kolumna strony wolna na liścik */
      [['mail', 0, 0], ['karteczka', 1, 0], ['wydruk', 2, 0], ['poczta głos.', 0, 1], ['kalendarz', 1, 1], ['logi', 2, 1], ['WHOIS', 0, 2], ['SMS', 1, 2], ['tablica', 2, 2]].map(([l, c, r]) => {
        const x = R + 36 + (c as number) * 132, y = top + 106 + (r as number) * 128;
        return `<g transform="rotate(${((c as number) + (r as number)) % 2 ? 2 : -2} ${x + 58} ${y + 54})"><rect x="${x}" y="${y}" width="116" height="110" rx="6" fill="${P.sky}" opacity="0.55" stroke="${P.grey}" stroke-width="2"/>` +
          `<rect x="${x}" y="${y}" width="116" height="20" rx="4" fill="${P.red}" opacity="0.85"/>` + t(x + 58, y + 15, 'DOWÓD', 11, { anchor: 'middle', bold: true, fill: P.white, spacing: 2 }) +
          `<rect x="${x + 14}" y="${y + 34}" width="88" height="56" rx="4" fill="${P.white}"/>` + t(x + 58, y + 68, l as string, 14, { anchor: 'middle', bold: true, fill: P.purpleDark }) + `</g>`;
      }).join(''),
    parts: {
      'slot-dowody': { x: L + 40, y: top + 236, w: 170, h: 56 },
      'slot-czas': { x: L + 225, y: top + 236, w: 170, h: 56 },
      'slot-xp': { x: L + 410, y: top + 236, w: 170, h: 56 },
      'slot-wnioski': { x: L + 40, y: top + 366, w: pw - 80, h: 240 },
      'slot-podpis': { x: L + 250, y: top + 620, w: pw - 290, h: 50 },
      'slot-pieczec': { x: R + 60, y: top + 520, w: 500, h: 180 },
      'slot-odznaka': { x: L + 470, y: top + 18, w: 120, h: 164 },
      'slot-liscik': { x: R + 440, y: top + 150, w: 170, h: 158 },
    },
  };
};

export const closedStamp: PropFn<{ text?: string; sub?: string }> = ({ text: tx = 'SPRAWA ZAMKNIĘTA', sub = 'Wydział Cyberbezpieczeństwa' }) => ({
  w: 600, h: 260,
  svg:
    `<g transform="translate(20 30) rotate(-8 280 100)" opacity="0.92"><rect x="10" y="20" width="540" height="160" rx="18" fill="none" stroke="${P.red}" stroke-width="10"/>` +
    `<rect x="26" y="36" width="508" height="128" rx="10" fill="none" stroke="${P.red}" stroke-width="3"/>` +
    t(280, 108, tx, 40, { anchor: 'middle', bold: true, fill: P.red, spacing: 2 }) +
    t(280, 148, sub.toUpperCase(), 18, { anchor: 'middle', bold: true, fill: P.red, spacing: 3 }) + `</g>`,
});

export const commissionerNote: PropFn<{ lines?: string[]; sign?: string }> = ({ lines = ['Dobra robota,', 'detektywie.', 'Następna sprawa', 'czeka.'], sign = '— A.W.' }) => ({
  w: 260, h: 240,
  svg:
    `<g class="a-flutter"><rect x="8" y="10" width="250" height="228" fill="${P.ink}" opacity="0.15"/><rect width="250" height="228" fill="${P.yellow}"/>` +
    `<rect width="250" height="26" fill="${P.yellowDark}" opacity="0.6"/>` +
    lines.slice(0, 4).map((l, i) => t(22, 64 + i * 34, l, 22, { fill: P.purpleDark, bold: i < 2 })).join('') +
    t(228, 214, sign, 20, { anchor: 'end', fill: P.purpleDark, bold: true }) + `</g>`,
});

export const ZAMKNIECIE_PROPS = { reportFolderOpen, closedStamp, commissionerNote };

/* ---------- przeglądarka: historia odwiedzin (dowód) ---------- */

export const browserHistory: PropFn<{ w?: number; h?: number; rows?: string[] }> = ({
  w = 1140, h = 740,
  rows = [
    // 9:04, nie 10:02: Anna wyszła od biurka po telefonie o 9:05 (kubek, lektor „jest teraz u Marka”) - D-094.
    '9:04|unfooly.com/intranet|Intranet Unfooly',
    '!8:58|bankwektor-weryfikacja.pl/login|Weryfikacja konta firmowego',
    '8:47|poczta.unfooly.com|Poczta — skrzynka odbiorcza',
    '8:31|kalendarz.unfooly.com|Kalendarz zespołu',
    '8:05|unfooly.com/stolowka|Menu stołówki',
  ],
}) => ({
  w, h,
  svg:
    shadow(w, h, 14, 10, 14) +
    `<rect width="${w}" height="${h}" rx="14" fill="${P.white}"/>` +
    `<path d="M0 14 a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v36 h-${w} z" fill="#E3E4EE"/>` +
    `<circle cx="26" cy="24" r="7" fill="${P.red}"/><circle cx="48" cy="24" r="7" fill="${P.yellow}"/><circle cx="70" cy="24" r="7" fill="${P.green}"/>` +
    `<path d="M100 50 v-26 a10 10 0 0 1 10 -10 h220 a10 10 0 0 1 10 10 v26 z" fill="${P.white}"/>` + t(120, 36, 'Historia', 15, { bold: true }) +
    `<rect x="140" y="62" width="${w - 180}" height="34" rx="17" fill="#F1F2F7"/>` + t(164, 85, 'historia przeglądania', 16, { fill: P.greyDark }) +
    `<line x1="0" y1="106" x2="${w}" y2="106" stroke="#E3E4EE" stroke-width="2"/>` +
    t(48, 160, 'Dzisiaj — wtorek', 22, { bold: true }) +
    rows.map((r, i) => {
      const hot = false; // bez podpowiedzi — gracz sam ma wyłapać domenę
      const [time, url, title] = r.replace(/^!/, '').split('|');
      const y = 190 + i * 96;
      return (hot ? `<rect x="32" y="${y}" width="${w - 64}" height="84" rx="10" fill="#FFF1F1" stroke="${P.red}" stroke-width="2"/>` : '') +
        t(60, y + 50, time, 20, { bold: true, fill: hot ? P.red : P.greyDark }) +
        `<rect x="140" y="${y + 28}" width="28" height="28" rx="6" fill="${hot ? P.purple : P.wall2}"/>` +
        t(190, y + 40, title, 19, { bold: true }) +
        t(190, y + 66, url, 16, { fill: hot ? P.red : P.greyDark, bold: hot });
    }).join(''),
});

export const PRZEGLADARKA_PROPS = { browserHistory };

/* ---------- wersje pionowe (telefon, D-098): dwie połówki poziomego klocka jedna pod drugą ---------- */
// Klocki składają INNE klocki - sięgają do nich przez rejestr (prop-registry.ts, wypełniany w props.ts), nie cyklicznym importem PROPS.

export const stackedHalves: PropFn<{ prop?: string; params?: Record<string, unknown>; gap?: number }> = ({ prop = 'caseFolderOpen', params = {}, gap = 24 }) => {
  const src = registeredProp(prop, 'stackedHalves')(params);
  const half = src.w / 2;
  // Część klocka przypisujemy do połówki po jej lewej krawędzi - część przecinająca środek wystawałaby poza przycięty obraz.
  for (const [k, p] of Object.entries(src.parts ?? {})) {
    if (p.x < half && p.x + p.w > half) throw new Error(`stackedHalves(${prop}): część "${k}" przecina środek klocka`);
  }
  const w = half, h = src.h * 2 + gap;
  const parts: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [k, p] of Object.entries(src.parts ?? {})) {
    parts[k] = p.x >= half ? { x: p.x - half, y: p.y + src.h + gap, w: p.w, h: p.h } : { ...p };
  }
  return {
    w, h,
    svg:
      `<clipPath id="lewa"><rect x="-20" y="-40" width="${half + 20}" height="${src.h + 60}"/></clipPath>` +
      `<clipPath id="prawa"><rect x="${half}" y="-40" width="${half + 40}" height="${src.h + 60}"/></clipPath>` +
      `<g clip-path="url(#lewa)">${src.svg}</g>` +
      `<g transform="translate(${-half} ${src.h + gap})"><g clip-path="url(#prawa)">${src.svg}</g></g>`,
    parts,
  };
};

export const badgeWalletPortrait: PropFn<{ unit?: string }> = (params) => {
  const src = registeredProp('badgeWallet', 'badgeWalletPortrait')(params);
  const W = 600, H = 1240, fold = H / 2;
  /* wycinki z poziomego etui: tarcza (lewa połowa) i karta (prawa połowa) */
  const badgeClip = { x: 40, y: 70, w: 470, h: 520 };
  const cardClip = { x: 580, y: 60, w: 480, h: 540 };
  const bx = (W - badgeClip.w) / 2 - badgeClip.x, by = (fold - badgeClip.h) / 2 - badgeClip.y + 10;
  const cx = (W - cardClip.w) / 2 - cardClip.x, cy = fold + (fold - cardClip.h) / 2 - cardClip.y - 10;
  const parts: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [k, p] of Object.entries(src.parts ?? {})) parts[k] = { x: p.x + cx, y: p.y + cy, w: p.w, h: p.h };
  return {
    w: W, h: H,
    svg:
      `<rect x="14" y="18" width="${W}" height="${H}" rx="34" fill="${P.ink}" opacity="0.22"/>` +
      `<rect width="${W}" height="${H}" rx="34" fill="${LEATHER}"/>` +
      `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="26" fill="none" stroke="${P.yellowDark}" stroke-width="3" stroke-dasharray="12 9" opacity="0.7"/>` +
      `<line x1="20" y1="${fold}" x2="${W - 20}" y2="${fold}" stroke="${P.ink}" stroke-width="6" opacity="0.4"/>` +
      `<clipPath id="odz"><rect x="${badgeClip.x}" y="${badgeClip.y}" width="${badgeClip.w}" height="${badgeClip.h}"/></clipPath>` +
      `<clipPath id="kar"><rect x="${cardClip.x}" y="${cardClip.y}" width="${cardClip.w}" height="${cardClip.h}"/></clipPath>` +
      `<g transform="translate(${bx} ${by})"><g clip-path="url(#odz)">${src.svg}</g></g>` +
      `<g transform="translate(${cx} ${cy})"><g clip-path="url(#kar)">${src.svg}</g></g>`,
    parts,
  };
};

export const PION_PROPS = { stackedHalves, badgeWalletPortrait };

/* ---------- ramka monitora dla scen „ekranowych” (pulpit itp.) — tło wokół przezroczyste (D-101) ---------- */
/**
 * Monitor z tapetą `wallpaper` (dawny kolor tła sceny) w ekranie `sw` x `sh`, z cieniem, nóżką i podstawką. Owija scenę skrypt
 * `wrap-in-monitor.ts` (elementy przesunięte o ramkę, tło sceny przezroczyste). Kolor tapety tylko jako #rgb/#rrggbb (trafia do atrybutu).
 */
/** Wysokość nóżki z podstawką pod ekranem (px) - ta sama w klocku i w kadrze sceny (scene-tools.ts wrapInMonitor). */
export const SCREEN_FRAME_STAND = 90;
export const screenFrame: PropFn<{ sw?: number; sh?: number; wallpaper?: string; bezel?: number }> = ({ sw = 1200, sh = 800, wallpaper = '#4E40B8', bezel = 28 }) => {
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(wallpaper)) throw new Error(`screenFrame: tapeta "${wallpaper}" nie jest kolorem #rgb/#rrggbb`);
  const w = sw + bezel * 2, h = sh + bezel * 2 + SCREEN_FRAME_STAND;
  return {
    w, h,
    svg:
      `<rect x="${w / 2 - 70}" y="${sh + bezel * 2 - 6}" width="140" height="62" fill="${P.greyDark}"/>` +
      `<rect x="${w / 2 - 190}" y="${sh + bezel * 2 + 52}" width="380" height="26" rx="13" fill="${P.greyDark}"/>` +
      `<rect x="12" y="16" width="${w}" height="${sh + bezel * 2}" rx="26" fill="${P.ink}" opacity="0.2"/>` +
      `<rect width="${w}" height="${sh + bezel * 2}" rx="26" fill="${P.ink}"/>` +
      `<rect x="${bezel}" y="${bezel}" width="${sw}" height="${sh}" rx="6" fill="${wallpaper}"/>`,
  };
};
export const EKRAN_PROPS = { screenFrame };

/* ---------- okna w wersji pionowej (telefon, U/D-104): duży tekst, zawijanie ---------- */

const wrapText = (s: string, max: number): string[] => {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + word).trim().length > max) {
      if (line) out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
};
/** Łączy linie złamane pod układ poziomy w akapity (pusta linia = nowy akapit; linie z „!” zostają osobno). */
const paragraphs = (lines: string[]): string[] => {
  const ps: string[] = [];
  let cur = '';
  for (const l of lines) {
    if (!l) {
      if (cur) ps.push(cur);
      cur = '';
      ps.push('');
      continue;
    }
    if (l.startsWith('!')) {
      if (cur) ps.push(cur);
      cur = '';
      ps.push(l);
      continue;
    }
    cur = (cur + ' ' + l).trim();
  }
  if (cur) ps.push(cur);
  return ps;
};

/** Mail na ekranie w pionie (te same parametry co `mailWindow`) - tekst 24-28 px w jednostkach grafiki, zawijany. */
export const mailWindowPortrait: PropFn<{
  from?: string; to?: string; date?: string; subject?: string; attachment?: string; body?: string[]; button?: string; link?: string; footer?: string[];
}> = ({ from = '', to = '', date = '', subject = '', attachment, body = [], button, link, footer = [] }) => {
  const w = 780, X = 36, F = 28, LH = 38, MAX = 40;
  let y = 120, g = '';
  const put = (s: string, o: Parameters<typeof t>[4] = {}, size = F, lh = LH) => {
    g += t(X, y, s, size, o);
    y += lh;
  };
  const field = (k: string, v: string, o: Parameters<typeof t>[4] = {}) => {
    put(k, { fill: P.greyDark, bold: true }, 20, 30);
    for (const l of wrapText(v, 44)) put(l, o, 24, 32);
    y += 8;
  };
  field('Od', from);
  field('Do', to);
  field('Data', date);
  field('Temat', subject, { bold: true, fill: P.red });
  const hdrEnd = y + 4;
  y += 36;
  if (attachment) {
    const aw = Math.min(w - 2 * X, 60 + attachment.length * 13);
    g += `<rect x="${X}" y="${y - 30}" width="${aw}" height="46" rx="23" fill="${P.wall2}"/>` + t(X + 22, y + 1, '📎 ' + attachment, 20);
    y += 50;
  }
  for (const p of paragraphs(body)) {
    if (!p) {
      y += 14;
      continue;
    }
    const red = p.startsWith('!');
    for (const l of wrapText(p.replace(/^!/, ''), MAX)) put(l, red ? { fill: P.red, bold: true } : {});
  }
  if (button) {
    y += 10;
    g += `<rect x="${X}" y="${y - 6}" width="${w - 2 * X}" height="70" rx="12" fill="${P.purple}"/>` + t(w / 2, y + 40, button, 28, { fill: P.white, bold: true, anchor: 'middle' });
    y += 100;
  }
  if (link) for (const l of wrapText(link.replace(/([/?=])/g, '$1 '), 42)) put(l.replace(/ /g, ''), { fill: P.greyDark }, 20, 28);
  y += 16;
  for (const p of paragraphs(footer)) {
    if (!p) {
      y += 10;
      continue;
    }
    for (const l of wrapText(p, 50)) put(l, { fill: P.greyDark }, 20, 28);
  }
  const h = y + 30;
  return {
    w, h,
    svg:
      shadow(w, h, 18) + `<rect width="${w}" height="${h}" rx="18" fill="${P.white}"/>` +
      `<rect y="72" width="${w}" height="${hdrEnd - 72}" fill="#FFF6F6"/>` +
      `<path d="M0 18 a18 18 0 0 1 18 -18 h${w - 36} a18 18 0 0 1 18 18 v54 h-${w} z" fill="${P.purple}"/>` +
      t(X, 48, 'Poczta — wiadomość', 26, { fill: P.white, bold: true }) +
      `<circle cx="${w - 40}" cy="36" r="10" fill="${P.red}"/><circle cx="${w - 72}" cy="36" r="10" fill="${P.yellow}"/><circle cx="${w - 104}" cy="36" r="10" fill="${P.green}"/>` + g,
  };
};

/**
 * Historia przeglądarki w pionie (te same wiersze co `browserHistory`: „godzina|adres|tytuł”, „!” na początku = wiersz wyróżniony -
 * godzina i tytuł na czerwono, jak w wersji poziomej).
 */
export const browserHistoryPortrait: PropFn<{ rows?: string[] }> = ({ rows = [] }) => {
  const w = 780, rowH = 150, h = 250 + rows.length * rowH;
  return {
    w, h,
    svg:
      shadow(w, h, 18) + `<rect width="${w}" height="${h}" rx="18" fill="${P.white}"/>` +
      `<path d="M0 18 a18 18 0 0 1 18 -18 h${w - 36} a18 18 0 0 1 18 18 v54 h-${w} z" fill="#E3E4EE"/>` +
      `<circle cx="36" cy="36" r="10" fill="${P.red}"/><circle cx="68" cy="36" r="10" fill="${P.yellow}"/><circle cx="100" cy="36" r="10" fill="${P.green}"/>` +
      t(140, 46, 'Historia', 26, { bold: true }) +
      `<rect x="30" y="92" width="${w - 60}" height="56" rx="28" fill="#F1F2F7"/>` + t(60, 130, 'historia przeglądania', 24, { fill: P.greyDark }) +
      t(36, 214, 'Dzisiaj — wtorek', 32, { bold: true }) +
      rows
        .map((r, i) => {
          const marked = r.startsWith('!');
          const [time, url, title] = r.replace(/^!/, '').split('|');
          const y = 250 + i * rowH;
          return `<line x1="30" y1="${y}" x2="${w - 30}" y2="${y}" stroke="#E3E4EE" stroke-width="2"/>` +
            t(36, y + 62, time, 30, { bold: true, fill: marked ? P.red : P.greyDark }) +
            t(160, y + 58, title, 30, { bold: true, fill: marked ? P.red : P.ink }) + t(160, y + 100, url, 24, { fill: P.greyDark });
        })
        .join(''),
  };
};

/* ---------- raport zamknięcia sprawy — pionowy, jedna duża strona (U/D-104) ---------- */
export const reportPortrait: PropFn<{ caseNo?: string; title?: string; bags?: string[] }> = ({
  caseNo = 'CS/2026/0915', title = 'Nieautoryzowany przelew',
  bags = ['mail', 'karteczka', 'wydruk', 'poczta głos.', 'kalendarz', 'logi', 'WHOIS', 'SMS', 'tablica'],
}) => {
  const w = 840, h = 1540, X = 50;
  const box = (x: number, label: string) => `<rect x="${x}" y="250" width="232" height="120" rx="12" fill="#F6F6F4"/>` + t(x + 20, 284, label, 20, { bold: true, fill: P.greyDark, spacing: 2 });
  return {
    w, h,
    svg:
      `<rect x="14" y="18" width="${w}" height="${h}" rx="20" fill="${P.ink}" opacity="0.18"/>` +
      `<rect width="${w}" height="${h}" rx="20" fill="${FOLDER}" stroke="${FOLDER_EDGE}" stroke-width="4"/>` +
      `<rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="8" fill="${P.white}"/>` +
      t(X, 92, 'RAPORT KOŃCOWY', 24, { bold: true, fill: P.greyDark, spacing: 4 }) +
      t(X, 150, caseNo, 52, { bold: true }) + t(X, 204, title, 34, { bold: true, fill: P.purpleDark }) +
      box(X, 'DOWODY') + box(X + 250, 'CZAS') + box(X + 500, 'XP') +
      t(X, 432, 'WNIOSKI ŚLEDCZEGO', 22, { bold: true, fill: P.greyDark, spacing: 2 }) +
      Array.from({ length: 8 }, (_, i) => `<line x1="${X}" y1="${500 + i * 50}" x2="${w - X}" y2="${500 + i * 50}" stroke="${P.sky}" stroke-width="2"/>`).join('') +
      t(X, 940, 'PODPIS PROWADZĄCEGO', 20, { bold: true, fill: P.greyDark, spacing: 2 }) +
      `<line x1="${X + 330}" y1="945" x2="${w - X}" y2="945" stroke="${P.ink}" stroke-width="3" stroke-dasharray="8 8"/>` +
      `<line x1="${X}" y1="990" x2="${w - X}" y2="990" stroke="${P.grey}" stroke-width="2"/>` +
      t(X, 1036, 'DOWODY RZECZOWE', 22, { bold: true, fill: P.greyDark, spacing: 2 }) +
      bags
        .slice(0, 9)
        .map((l, i) => {
          const c = i % 3, r = Math.floor(i / 3), x = X + c * 150, y = 1062 + r * 138;
          return `<g transform="rotate(${(c + r) % 2 ? 2 : -2} ${x + 66} ${y + 60})"><rect x="${x}" y="${y}" width="132" height="120" rx="6" fill="${P.sky}" opacity="0.55" stroke="${P.grey}" stroke-width="2"/>` +
            `<rect x="${x}" y="${y}" width="132" height="24" rx="4" fill="${P.red}" opacity="0.85"/>` + t(x + 66, y + 18, 'DOWÓD', 14, { anchor: 'middle', bold: true, fill: P.white, spacing: 2 }) +
            `<rect x="${x + 14}" y="${y + 38}" width="104" height="64" rx="4" fill="${P.white}"/>` + t(x + 66, y + 78, l, 17, { anchor: 'middle', bold: true, fill: P.purpleDark }) + `</g>`;
        })
        .join(''),
    parts: {
      'slot-dowody': { x: X, y: 294, w: 232, h: 72 },
      'slot-czas': { x: X + 250, y: 294, w: 232, h: 72 },
      'slot-xp': { x: X + 500, y: 294, w: 232, h: 72 },
      'slot-wnioski': { x: X, y: 452, w: w - 2 * X, h: 420 },
      'slot-podpis': { x: X + 330, y: 880, w: w - 2 * X - 330, h: 64 },
      'slot-pieczec': { x: 500, y: 1330, w: 320, h: 170 },
      'slot-liscik': { x: 540, y: 1062, w: 250, h: 240 },
    },
  };
};

export const PION_OKNA_PROPS = { mailWindowPortrait, browserHistoryPortrait, reportPortrait };
