import { P } from './palette.js';
import type { PropFn, PropOutput } from './types.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const text = (x: number, y: number, s: unknown, size: number, o: { fill?: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill ?? P.ink}"${o.bold ? ' font-weight="bold"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;

const lines = (x: number, y: number, widths: number[], gap = 14, h = 6, fill = P.grey) =>
  widths.map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`).join('');

/* ---------- ściana / tło ---------- */

export const window_: PropFn<{ w?: number; h?: number; sun?: boolean }> = ({ w = 300, h = 280, sun = true }) => ({
  w, h,
  svg:
    `<rect width="${w}" height="${h}" rx="10" fill="${P.white}" stroke="${P.grey}" stroke-width="8"/>` +
    `<rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="${P.sky}"/>` +
    `<rect x="${w / 2 - 4}" y="12" width="8" height="${h - 24}" fill="${P.grey}"/>` +
    `<rect x="12" y="${h / 2 - 4}" width="${w - 24}" height="8" fill="${P.grey}"/>` +
    (sun ? `<circle cx="${w * 0.77}" cy="${h * 0.25}" r="${Math.min(w, h) * 0.09}" fill="${P.sun}"/>` : ''),
});

export const calendar: PropFn<{ month?: string; markedDay?: number; note?: string; markedCell?: [number, number] }> = ({
  month = 'WRZESIEŃ', markedDay, note, markedCell = [2, 1],
}) => {
  const w = 192, h = 220;
  let cells = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++)
    cells += `<rect x="${12 + c * 26}" y="${56 + r * 38}" width="22" height="30" rx="3" fill="${P.wall}"/>`;
  const [mr, mc] = markedCell;
  const cx = 12 + mc * 26 + 11, cy = 56 + mr * 38 + 15;
  return {
    w, h,
    svg:
      `<rect width="${w}" height="${h}" rx="8" fill="${P.white}" stroke="${P.grey}" stroke-width="4"/>` +
      `<rect width="${w}" height="44" rx="8" fill="${P.purple}"/><rect y="30" width="${w}" height="14" fill="${P.purple}"/>` +
      text(w / 2, 31, month, 22, { fill: P.white, bold: true, anchor: 'middle' }) + cells +
      (markedDay != null
        ? `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${P.red}" stroke-width="5"/>` + text(cx, cy + 6, markedDay, 16, { fill: P.red, bold: true, anchor: 'middle' })
        : '') +
      (note ? text(w / 2, 210, note, 12, { fill: P.red, bold: true, anchor: 'middle' }) : ''),
  };
};

export const shelf: PropFn<{ binders?: string[] }> = ({ binders = [P.purple, P.orange, P.teal, P.purpleDark] }) => {
  const w = 260, h = 84;
  return {
    w, h,
    svg:
      `<rect y="70" width="${w}" height="14" rx="4" fill="${P.greyDark}"/>` +
      binders.map((c, i) => `<rect x="${20 + i * 56}" width="44" height="70" rx="4" fill="${c}" opacity="0.9"/>`).join(''),
  };
};

export const whiteboard: PropFn<{ w?: number; h?: number; lines?: string[] }> = ({ w = 360, h = 220, lines: ls = [] }) => ({
  w, h,
  svg:
    `<rect width="${w}" height="${h}" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="8"/>` +
    ls.map((l, i) => text(24, 44 + i * 30, l, 18, { fill: i === 0 ? P.purpleDark : P.ink, bold: i === 0 })).join('') +
    `<rect x="${w / 2 - 60}" y="${h - 4}" width="120" height="10" rx="5" fill="${P.greyDark}"/>`,
});

export const door: PropFn<{ open?: boolean; label?: string }> = ({ open = false, label }) => {
  const w = 170, h = 400;
  return {
    w, h,
    svg:
      `<rect width="${w}" height="${h}" rx="6" fill="${open ? P.ink : '#A8865F'}"/>` +
      (open ? `<rect x="10" y="10" width="${w - 20}" height="${h - 10}" fill="#9A7B55" transform="skewY(-6)"/>` : `<rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="4" fill="none" stroke="#8D6E48" stroke-width="6"/>`) +
      `<circle cx="${open ? 32 : w - 34}" cy="${h / 2}" r="8" fill="${P.yellowDark}"/>` +
      (label ? `<rect x="${w / 2 - 50}" y="40" width="100" height="26" rx="4" fill="${P.white}"/>` + text(w / 2, 58, label, 13, { anchor: 'middle', bold: true }) : ''),
  };
};

/* ---------- meble ---------- */

export const desk: PropFn<{ w?: number; legs?: boolean }> = ({ w = 1360, legs = true }) => ({
  w, h: legs ? 200 : 56,
  svg:
    `<rect width="${w}" height="40" rx="10" fill="${P.desk}"/><rect y="36" width="${w}" height="16" fill="${P.deskDark}"/>` +
    (legs ? `<rect x="50" y="50" width="40" height="150" fill="${P.deskDark}"/><rect x="${w - 90}" y="50" width="40" height="150" fill="${P.deskDark}"/>` : ''),
});

export const drawerUnit: PropFn<{ drawers?: number }> = ({ drawers = 2 }) => {
  const w = 260, h = 30 + drawers * 60;
  let d = '';
  for (let i = 0; i < drawers; i++)
    d += `<rect x="20" y="${22 + i * 60}" width="220" height="44" rx="6" fill="${P.wall2}"/><rect x="110" y="${40 + i * 60}" width="40" height="8" rx="4" fill="${P.greyDark}"/>`;
  return { w, h, svg: `<rect width="${w}" height="${h}" rx="8" fill="${P.white}" stroke="${P.grey}" stroke-width="4"/>` + d };
};

export const chair: PropFn<Record<string, never>> = () => ({
  w: 220, h: 132,
  svg:
    `<rect width="220" height="60" rx="14" fill="${P.purple}"/><rect y="40" width="220" height="30" rx="10" fill="${P.purpleDark}"/>` +
    `<rect x="95" y="70" width="30" height="50" fill="${P.greyDark}"/><rect x="20" y="118" width="180" height="14" rx="7" fill="${P.greyDark}"/>`,
});

export const plant: PropFn<Record<string, never>> = () => ({
  w: 120, h: 190,
  svg:
    `<rect x="30" y="110" width="60" height="80" rx="8" fill="${P.orange}"/>` +
    [[-30, -40, 34], [30, -46, 30], [0, -70, 36], [-10, -20, 26], [22, -14, 24]]
      .map(([dx, dy, r]) => `<circle cx="${60 + dx}" cy="${110 + dy}" r="${r}" fill="${P.green}"/>`).join(''),
});

/* ---------- urządzenia ---------- */

export type ScreenKind = 'mail' | 'login' | 'locked' | 'blank' | 'spreadsheet';

function screenContent(kind: ScreenKind, o: { subject?: string; sender?: string; button?: string; title?: string }, w: number, h: number): string {
  const bar = `<rect width="${w}" height="34" fill="${P.purple}"/>`;
  switch (kind) {
    case 'mail':
      return bar + text(14, 23, o.title ?? 'Poczta — Skrzynka odbiorcza', 16, { fill: P.white, bold: true }) +
        `<rect y="34" width="110" height="${h - 34}" fill="${P.wall2}"/>` + lines(12, 48, [60, 72, 84, 60, 72, 84], 30, 10) +
        `<rect x="110" y="34" width="${w - 110}" height="${h - 34}" fill="${P.white}"/><rect x="110" y="34" width="${w - 110}" height="42" fill="#FFF1F1"/>` +
        text(122, 52, o.subject ?? 'PILNE: weryfikacja konta', 13, { fill: P.red, bold: true }) +
        text(122, 68, o.sender ?? 'nadawca · 8:47', 11, { fill: P.greyDark }) +
        lines(122, 90, [250, 227, 204, 250, 181, 227, 204], 20, 8) +
        `<rect x="122" y="${h - 30}" width="150" height="20" rx="5" fill="${P.purple}"/>` +
        text(197, h - 16, o.button ?? 'Przejdź do weryfikacji', 11, { fill: P.white, bold: true, anchor: 'middle' });
    case 'login':
      return bar + text(14, 23, o.title ?? 'Logowanie', 16, { fill: P.white, bold: true }) +
        `<rect x="${w / 2 - 110}" y="70" width="220" height="30" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="2"/>` +
        `<rect x="${w / 2 - 110}" y="112" width="220" height="30" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="2"/>` +
        text(w / 2 - 100, 90, 'login', 12, { fill: P.greyDark }) + text(w / 2 - 100, 132, '••••••••', 12, { fill: P.greyDark }) +
        `<rect x="${w / 2 - 60}" y="160" width="120" height="30" rx="6" fill="${P.purple}"/>` + text(w / 2, 180, o.button ?? 'Zaloguj', 13, { fill: P.white, bold: true, anchor: 'middle' });
    case 'locked':
      return `<rect width="${w}" height="${h}" fill="${P.ink}"/>` +
        `<rect x="${w / 2 - 22}" y="${h / 2 - 18}" width="44" height="34" rx="6" fill="${P.red}"/><rect x="${w / 2 - 14}" y="${h / 2 - 40}" width="28" height="30" rx="14" fill="none" stroke="${P.red}" stroke-width="6"/>` +
        text(w / 2, h / 2 + 50, o.title ?? 'Dostęp zablokowany', 14, { fill: P.white, bold: true, anchor: 'middle' });
    case 'spreadsheet': {
      let g = bar + text(14, 23, o.title ?? 'Arkusz — przelewy', 16, { fill: P.white, bold: true });
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
        g += `<rect x="${12 + c * 74}" y="${46 + r * 28}" width="70" height="24" fill="${r === 0 ? P.wall2 : P.white}" stroke="${P.grey}" stroke-width="1"/>`;
      return g;
    }
    default:
      return '';
  }
}

export const monitor: PropFn<{ screen?: ScreenKind; subject?: string; sender?: string; button?: string; title?: string; sticky?: string[] }> = ({
  screen = 'blank', sticky, ...o
}) => {
  const w = 420, h = 332;
  const out: PropOutput = {
    w, h,
    svg:
      `<rect x="160" y="280" width="100" height="50" rx="8" fill="${P.greyDark}"/><rect x="100" y="316" width="220" height="16" rx="8" fill="${P.greyDark}"/>` +
      `<rect width="420" height="290" rx="16" fill="${P.ink}"/>` +
      `<g transform="translate(18 18)"><rect width="384" height="250" rx="6" fill="${P.screen}"/><clipPath id="scr"><rect width="384" height="250" rx="6"/></clipPath><g clip-path="url(#scr)">${screenContent(screen, o, 384, 250)}</g></g>`,
  };
  if (sticky) {
    const sv = stickyNote({ lines: sticky });
    out.svg += `<g transform="translate(368 -22) rotate(6 46 40)">${sv.svg}</g>`;
    out.parts = { sticky: { x: 360, y: -30, w: 110, h: 100 } };
  }
  return out;
};

export const stickyNote: PropFn<{ lines?: string[]; color?: string }> = ({ lines: ls = ['notatka'], color = P.yellow }) => {
  const w = 92, h = 80;
  return {
    w, h,
    svg:
      `<rect width="${w}" height="${h}" fill="${color}"/><rect width="${w}" height="12" fill="${P.yellowDark}" opacity="0.6"/>` +
      `<rect x="32" y="-6" width="28" height="12" rx="3" fill="${P.ink}" opacity="0.25"/>` +
      ls.slice(0, 3).map((l, i) => text(w / 2, 34 + i * 22, l, i === 0 ? 15 : 11, { anchor: 'middle', bold: i === 0, fill: i === 0 ? P.ink : P.purpleDark })).join(''),
  };
};

export const phone: PropFn<{ led?: boolean; display?: string[]; note?: string }> = ({ led = false, display = [], note }) => {
  const w = 180, h = note ? 112 : 90;
  let keys = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) keys += `<rect x="${96 + c * 24}" y="${32 + r * 15}" width="18" height="10" rx="2" fill="${P.greyDark}"/>`;
  return {
    w, h,
    svg:
      `<rect y="18" width="180" height="70" rx="12" fill="${P.ink}"/><rect width="180" height="22" rx="11" fill="${P.greyDark}"/>` +
      `<rect x="12" y="30" width="70" height="46" rx="6" fill="${P.sky}"/>` +
      display.slice(0, 2).map((l, i) => text(47, 49 + i * 15, l, 9, { anchor: 'middle', bold: i === 1 })).join('') + keys +
      (led ? `<circle cx="166" cy="30" r="7" fill="${P.red}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>` : '') +
      (note ? `<g transform="rotate(-4 50 79)"><rect x="4" y="68" width="92" height="22" rx="4" fill="${P.yellow}"/>${text(50, 83, note, 9, { anchor: 'middle', bold: true })}</g>` : ''),
  };
};

export const printer: PropFn<{ paper?: boolean; paperText?: string; ready?: boolean }> = ({ paper = true, paperText, ready = true }) => {
  const w = 230, h = 130;
  return {
    w, h,
    svg:
      `<rect y="20" width="230" height="110" rx="14" fill="${P.white}" stroke="${P.grey}" stroke-width="5"/><rect x="30" width="170" height="30" rx="6" fill="${P.grey}"/>` +
      `<rect x="20" y="55" width="190" height="10" rx="5" fill="${P.ink}" opacity="0.15"/>` +
      (paper
        ? `<g transform="rotate(-4 115 85)"><rect x="40" y="40" width="150" height="90" rx="4" fill="${P.white}" stroke="${P.grey}" stroke-width="3"/>${lines(55, 55, [110, 98, 86, 74, 62], 13, 5)}${paperText ? text(66, 120, paperText, 11, { fill: P.red, bold: true }) : ''}</g>`
        : '') +
      `<circle cx="210" cy="40" r="6" fill="${ready ? P.green : P.red}"/>`,
  };
};

export const mug: PropFn<{ label?: string[]; color?: string }> = ({ label = [], color = P.teal }) => ({
  w: 80, h: 62,
  svg:
    `<rect x="52" y="15" width="26" height="30" rx="10" fill="none" stroke="${color}" stroke-width="7"/><rect width="66" height="60" rx="8" fill="${color}"/>` +
    `<ellipse cx="33" cy="0" rx="33" ry="8" fill="${P.ink}" opacity="0.25"/>` +
    label.slice(0, 2).map((l, i) => text(33, 35 + i * 11, l, 8, { fill: P.white, bold: true, anchor: 'middle' })).join(''),
});

export const keyboardMouse: PropFn<Record<string, never>> = () => ({
  w: 370, h: 26,
  svg: `<rect width="300" height="22" rx="6" fill="${P.white}" stroke="${P.grey}" stroke-width="3"/><rect x="330" width="36" height="24" rx="12" fill="${P.white}" stroke="${P.grey}" stroke-width="3"/>`,
});

export const laptop: PropFn<{ screen?: ScreenKind; subject?: string; sender?: string; title?: string; button?: string }> = ({ screen = 'blank', ...o }) => {
  const w = 340, h = 230;
  return {
    w, h,
    svg:
      `<rect x="20" width="300" height="200" rx="12" fill="${P.ink}"/>` +
      `<g transform="translate(34 12)"><rect width="272" height="176" rx="4" fill="${P.screen}"/><clipPath id="lap"><rect width="272" height="176" rx="4"/></clipPath><g clip-path="url(#lap)" transform="scale(0.71)">${screenContent(screen, o, 384, 250)}</g></g>` +
      `<rect y="200" width="340" height="18" rx="6" fill="${P.greyDark}"/><rect x="130" y="204" width="80" height="6" rx="3" fill="${P.grey}"/>`,
  };
};

export const smartphone: PropFn<{ lines?: string[]; badge?: string }> = ({ lines: ls = [], badge }) => {
  const w = 90, h = 170;
  return {
    w, h,
    svg:
      `<rect width="90" height="170" rx="14" fill="${P.ink}"/><rect x="7" y="14" width="76" height="142" rx="8" fill="${P.screen}"/>` +
      `<rect x="14" y="22" width="62" height="40" rx="6" fill="${P.wall2}"/>` +
      ls.slice(0, 3).map((l, i) => text(45, 36 + i * 12, l, 8, { anchor: 'middle', bold: i === 0 })).join('') +
      lines(14, 72, [62, 50, 62, 40], 14, 6) +
      (badge ? `<circle cx="76" cy="20" r="9" fill="${P.red}"/>` + text(76, 24, badge, 10, { fill: P.white, bold: true, anchor: 'middle' }) : ''),
  };
};

export const box: PropFn<{ w?: number; h?: number; label?: string }> = ({ w = 120, h = 90, label }) => ({
  w, h,
  svg: `<rect width="${w}" height="${h}" rx="6" fill="#C9A87C"/><rect y="${h * 0.3}" width="${w}" height="10" fill="#B08D5F"/>` + (label ? text(w / 2, h * 0.7, label, 12, { anchor: 'middle', bold: true, fill: P.ink }) : ''),
});


/* ---------- korytarz / tablice ---------- */

export const wallSign: PropFn<{ text?: string; arrow?: 'left' | 'right' | 'none' }> = ({ text: t = 'Księgowość', arrow = 'right' }) => {
  const w = 240, h = 56;
  const a = arrow === 'none' ? '' : arrow === 'right'
    ? `<path d="M${w - 44} 18 l22 10 l-22 10 z" fill="${P.white}"/>`
    : `<path d="M44 18 l-22 10 l22 10 z" fill="${P.white}"/>`;
  return {
    w, h,
    svg: `<rect width="${w}" height="${h}" rx="8" fill="${P.purple}"/>` + a +
      text(arrow === 'left' ? 56 : 20, 36, t, 20, { fill: P.white, bold: true }),
  };
};

export const noticeBoard: PropFn<{ w?: number; h?: number; title?: string; notes?: string[] }> = ({ w = 360, h = 240, title = 'TABLICA OGŁOSZEŃ', notes = [] }) => {
  const cols = [P.yellow, P.white, '#DFF5E6', P.sky];
  return {
    w, h,
    svg:
      `<rect width="${w}" height="${h}" rx="6" fill="#C9A87C"/><rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="#E8D4B3"/>` +
      `<rect x="${w / 2 - 110}" y="18" width="220" height="30" rx="4" fill="${P.purple}"/>` + text(w / 2, 39, title, 15, { fill: P.white, bold: true, anchor: 'middle' }) +
      notes.slice(0, 4).map((n, i) => {
        const x = 24 + (i % 2) * (w / 2 - 12), y = 62 + Math.floor(i / 2) * 84, r = (i % 2 ? 3 : -3);
        return `<g transform="rotate(${r} ${x + 70} ${y + 34})"><rect x="${x}" y="${y}" width="${w / 2 - 36}" height="68" fill="${cols[i % cols.length]}" stroke="${P.grey}" stroke-width="1"/><circle cx="${x + (w / 2 - 36) / 2}" cy="${y + 6}" r="5" fill="${P.red}"/>${text(x + 10, y + 30, n.split('|')[0], 12, { bold: true })}${text(x + 10, y + 50, n.split('|')[1] ?? '', 11, { fill: P.greyDark })}</g>`;
      }).join(''),
  };
};

/* ---------- pulpit komputera ---------- */

export type IconKind = 'outlook' | 'trash' | 'folder' | 'browser' | 'sheet';

export const desktopIcon: PropFn<{ icon?: IconKind; label?: string; badge?: string }> = ({ icon = 'folder', label, badge }) => {
  const w = 120, h = 128;
  let g = '';
  switch (icon) {
    case 'outlook':
      g = `<rect x="20" y="16" width="80" height="72" rx="12" fill="${P.purple}"/><rect x="34" y="34" width="52" height="36" rx="4" fill="${P.white}"/><path d="M34 36 l26 20 l26 -20" fill="none" stroke="${P.purple}" stroke-width="4"/>`;
      break;
    case 'trash':
      g = `<rect x="34" y="30" width="52" height="60" rx="6" fill="${P.greyDark}"/><rect x="26" y="20" width="68" height="12" rx="4" fill="${P.greyDark}"/><rect x="48" y="12" width="24" height="10" rx="3" fill="${P.greyDark}"/><rect x="46" y="42" width="6" height="38" rx="3" fill="${P.white}"/><rect x="68" y="42" width="6" height="38" rx="3" fill="${P.white}"/>`;
      break;
    case 'browser':
      g = `<circle cx="60" cy="52" r="38" fill="${P.teal}"/><ellipse cx="60" cy="52" rx="16" ry="38" fill="none" stroke="${P.white}" stroke-width="4"/><line x1="22" y1="52" x2="98" y2="52" stroke="${P.white}" stroke-width="4"/>`;
      break;
    case 'sheet':
      g = `<rect x="26" y="14" width="68" height="78" rx="6" fill="${P.green}"/>` + [0, 1, 2, 3].map(i => `<rect x="36" y="${28 + i * 16}" width="48" height="10" fill="${P.white}" opacity="0.9"/>`).join('');
      break;
    default:
      g = `<path d="M22 30 h32 l10 10 h44 v50 a6 6 0 0 1 -6 6 h-74 a6 6 0 0 1 -6 -6 z" fill="${P.yellowDark}"/><rect x="22" y="46" width="86" height="50" rx="6" fill="${P.yellow}"/>`;
  }
  return {
    w, h,
    svg: g + (label ? `<rect x="6" y="98" width="108" height="24" rx="6" fill="${P.ink}" opacity="0.35"/>` + text(60, 115, label, 14, { fill: P.white, bold: true, anchor: 'middle' }) : '') +
      (badge ? `<circle cx="98" cy="20" r="14" fill="${P.red}"/>` + text(98, 25, badge, 14, { fill: P.white, bold: true, anchor: 'middle' }) : ''),
  };
};

export const taskbar: PropFn<{ w?: number; clock?: string; date?: string }> = ({ w = 1200, clock = '8:52', date = 'wtorek' }) => ({
  w, h: 56,
  svg:
    `<rect width="${w}" height="56" fill="${P.ink}"/>` +
    `<rect x="14" y="14" width="28" height="28" rx="6" fill="${P.purple}"/><rect x="21" y="21" width="6" height="6" fill="${P.white}"/><rect x="29" y="21" width="6" height="6" fill="${P.white}"/><rect x="21" y="29" width="6" height="6" fill="${P.white}"/><rect x="29" y="29" width="6" height="6" fill="${P.white}"/>` +
    `<rect x="60" y="12" width="260" height="32" rx="16" fill="${P.white}" opacity="0.15"/>` + text(80, 33, 'Wyszukaj', 14, { fill: P.white }) +
    text(w - 24, 26, clock, 15, { fill: P.white, bold: true, anchor: 'end' }) + text(w - 24, 46, date, 12, { fill: P.white, anchor: 'end' }),
});

/* ---------- dokumenty / zbliżenia ---------- */

export const mailWindow: PropFn<{
  w?: number; h?: number; from?: string; to?: string; date?: string; subject?: string; attachment?: string;
  body?: string[]; button?: string; link?: string; footer?: string[];
}> = ({ w = 1140, h = 740, from = '', to = '', date = '', subject = '', attachment, body = [], button, link, footer = [] }) => {
  const hdr = [['Od:', from], ['Do:', to], ['Data:', date], ['Temat:', subject]];
  let y = 96;
  const bodySvg = body.map(l => {
    const line = l ? text(190, y, l.replace(/^!/, ''), 17, l.startsWith('!') ? { fill: P.red, bold: true } : {}) : '';
    y += l ? 28 : 16;
    return line;
  }).join('');
  const btn = button ? `<rect x="190" y="${y + 6}" width="260" height="44" rx="8" fill="${P.purple}"/>` + text(320, y + 34, button, 17, { fill: P.white, bold: true, anchor: 'middle' }) +
    (link ? text(470, y + 34, link, 14, { fill: P.greyDark }) : '') : '';
  y += button ? 80 : 10;
  const foot = footer.map((l, i) => text(190, y + i * 24, l, 14, { fill: P.greyDark })).join('');
  return {
    w, h,
    svg:
      `<rect width="${w}" height="${h}" rx="12" fill="${P.white}" stroke="${P.grey}" stroke-width="4"/>` +
      `<rect width="${w}" height="48" rx="12" fill="${P.purple}"/><rect y="30" width="${w}" height="18" fill="${P.purple}"/>` +
      text(20, 31, 'Poczta — wiadomość', 18, { fill: P.white, bold: true }) +
      `<circle cx="${w - 30}" cy="24" r="8" fill="${P.red}"/><circle cx="${w - 56}" cy="24" r="8" fill="${P.yellow}"/><circle cx="${w - 82}" cy="24" r="8" fill="${P.green}"/>` +
      `<rect y="48" width="160" height="${h - 48}" fill="${P.wall2}"/>` +
      ['Odebrane', 'Wysłane', 'Kosz', 'Spam'].map((f, i) => (i === 0 ? `<rect x="10" y="${64 + i * 40}" width="140" height="32" rx="6" fill="${P.purple}" opacity="0.15"/>` : '') + text(24, 86 + i * 40, f, 15, { bold: i === 0 })).join('') +
      `<rect x="160" y="48" width="${w - 160}" height="150" fill="#FFF6F6"/>` +
      hdr.map(([k, v], i) => text(190, 78 + i * 30, k, 15, { fill: P.greyDark, bold: true }) + text(260, 78 + i * 30, v, 15, { bold: i === 3, fill: i === 3 ? P.red : P.ink })).join('') +
      (attachment ? `<rect x="190" y="200" width="${Math.min(w - 220, 24 + attachment.length * 9)}" height="30" rx="15" fill="${P.wall2}"/><path d="M204 215 l8 -8 a5 5 0 0 1 7 7 l-9 9 a8 8 0 0 1 -11 -11 l9 -9" fill="none" stroke="${P.ink}" stroke-width="2"/>` + text(226, 220, attachment, 13, {}) : '') +
      `<g transform="translate(0 ${attachment ? 160 : 130})">${bodySvg}${btn}${foot}</g>`,
  };
};

export const paper: PropFn<{ w?: number; h?: number; title?: string; lines?: string[]; stamp?: string }> = ({ w = 700, h = 980, title = '', lines: ls = [], stamp }) => ({
  w, h,
  svg:
    `<rect x="8" y="10" width="${w}" height="${h}" rx="4" fill="${P.ink}" opacity="0.15"/>` +
    `<rect width="${w}" height="${h}" rx="4" fill="${P.white}" stroke="${P.grey}" stroke-width="3"/>` +
    `<rect x="50" y="50" width="120" height="36" rx="6" fill="${P.purple}"/>` + text(110, 75, 'BANK', 18, { fill: P.white, bold: true, anchor: 'middle' }) +
    text(190, 76, title, 22, { bold: true }) +
    `<line x1="50" y1="110" x2="${w - 50}" y2="110" stroke="${P.grey}" stroke-width="2"/>` +
    ls.map((l, i) => {
      const [k, v] = l.includes('|') ? l.split('|') : ['', l];
      const yy = 160 + i * 48;
      return text(50, yy, k, 17, { fill: P.greyDark, bold: true }) + text(k ? 300 : 50, yy, v, 19, { bold: /PLN|zł/.test(v) });
    }).join('') +
    (stamp ? `<g transform="rotate(-12 ${w - 200} ${h - 160})"><rect x="${w - 330}" y="${h - 200}" width="260" height="80" rx="10" fill="none" stroke="${P.red}" stroke-width="5"/>${text(w - 200, h - 150, stamp, 26, { fill: P.red, bold: true, anchor: 'middle' })}</g>` : '') +
    `<rect x="50" y="${h - 60}" width="${w - 100}" height="18" rx="3" fill="${P.wall2}"/>`,
});

export const PROPS: Record<string, PropFn<any>> = {
  window: window_, calendar, shelf, whiteboard, door,
  desk, drawerUnit, chair, plant,
  monitor, stickyNote, phone, printer, mug, keyboardMouse, laptop, smartphone, box,
  wallSign, noticeBoard, desktopIcon, taskbar, mailWindow, paper,
};
