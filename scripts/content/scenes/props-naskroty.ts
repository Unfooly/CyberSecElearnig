/**
 * Klocki modułu 4 „Na skróty” (shadow IT, tryb prosty, D-132): laptop Bartka, okna darmowych narzędzi (czat AI, prywatny dysk w chmurze,
 * dokument), ikona programu z internetu, prywatny pendrive i tablica z kartami skutków. Klocki rysują tylko kształty i wystawiają sloty
 * `slot-*` - napisy wpala scena klockami `textBox` ze `strings` (D-135), więc dopasowanie, minimum 16 px na telefonie (`minTextPx`) i
 * pseudo-lokalizację (D-143) sprawdza kompozytor. Narzędzia są fikcyjne i generyczne: bez logo, bez nazw prawdziwych usług.
 *
 * Sceny modułu używają klocków w skali 1 (kanwa sceny = lokalne jednostki klocka), więc pozycja `textBox` = pozycja elementu + slot.
 * UWAGA: pozycje `textBox` w `examples/na-skroty/*.json` są przeliczone ręcznie ze slotów poniżej - zmiana slotu wymaga poprawki scen.
 */
import { P } from './palette.js';
import type { PropFn } from './types.js';

type Rect = { x: number; y: number; w: number; h: number };

const BAR = 80;
/** Środek gniazda USB laptopa od górnej krawędzi podstawy (`laptopFront`) i środek wtyku pendrive'a (`usbStick`, lokalne y). */
const PORT_Y = 37;
const PLUG_Y = 40;
const CORK = '#C89B6D';
const CORK_EDGE = '#9C7247';

/** Cień kształtu; `at` - przesunięcie całego cienia (transform), gdy kształt nie leży w (0,0). */
const shadow = (w: number, h: number, rx: number, dx = 10, dy = 14, at?: [number, number]) =>
  `<rect ${at ? `transform="translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})" ` : ''}x="${dx}" y="${dy}" width="${w}" height="${h}" rx="${rx}" fill="${P.ink}" opacity="0.18"/>`;

/** Okno aplikacji: pasek tytułu `bar` wysokości (kolor narzędzia, ikona w kółku - rysowana dla paska 80) i białe wnętrze. */
const windowFrame = (w: number, h: number, color: string, icon: string, bar: number) =>
  shadow(w, h, 18) +
  `<rect width="${w}" height="${h}" rx="18" fill="${P.white}"/>` +
  `<path d="M0 18 a18 18 0 0 1 18 -18 h${w - 36} a18 18 0 0 1 18 18 v${bar - 18} h-${w} z" fill="${color}"/>` +
  `<g transform="translate(0 ${(bar - BAR) / 2})"><circle cx="44" cy="${BAR / 2}" r="24" fill="${P.white}" opacity="0.95"/>${icon}</g>` +
  [0, 1, 2].map((i) => `<circle cx="${w - 34 - i * 30}" cy="${bar / 2}" r="8" fill="${P.white}" opacity="0.6"/>`).join('');

/** Slot nazwy w pasku tytułu: od ikony do kropek okna. */
const titleSlot = (w: number, bar: number): Rect => ({ x: 84, y: 10, w: w - 84 - 110, h: bar - 20 });

/**
 * Laptop od frontu (ekran i podstawa). `sw`×`sh` - wyświetlacz, `wallpaper` - tapeta, `over` - o ile podstawa wystaje w bok, `port` - bok
 * podstawy z gniazdem pendrive'a (w scenie poziomej prawy: lewy dolny róg sceny zasłania dymek podpowiedzi odtwarzacza). Podstawa ma
 * krótki pionowy bok z gniazdem: środek gniazda na lokalnym y = PORT_Y (od góry podstawy), krawędź na x = 0 albo x = w. Pendrive rysuje
 * scena POD laptopem (wcześniej w `items`) - podstawa przykrywa koniec wtyku, więc wygląda na wsunięty. Części: `slot-ekran`, `port`.
 * Lokalnie: ramka 30 wokół ekranu, podstawa ma 70 wysokości.
 */
export const laptopFront: PropFn<{ sw?: number; sh?: number; wallpaper?: string; port?: 'left' | 'right'; over?: number }> = ({
  sw = 1240, sh = 740, wallpaper = P.purpleDark, port = 'left', over = 60,
}) => {
  const bezel = 30, base = 70;
  const w = sw + 2 * bezel + 2 * over, h = sh + 2 * bezel + base;
  const sx = over, top = sh + 2 * bezel;
  const slot = { x: port === 'left' ? 0 : w - 8, y: top + PORT_Y - 15, w: 8, h: 30 };
  return {
    w, h,
    svg:
      `<rect x="${sx + 12}" y="16" width="${sw + 2 * bezel}" height="${top}" rx="26" fill="${P.ink}" opacity="0.2"/>` +
      `<rect x="${sx}" y="0" width="${sw + 2 * bezel}" height="${top}" rx="26" fill="${P.ink}"/>` +
      `<rect x="${sx + bezel}" y="${bezel}" width="${sw}" height="${sh}" rx="8" fill="${wallpaper}"/>` +
      `<circle cx="${w / 2}" cy="${bezel / 2}" r="5" fill="${P.greyDark}"/>` +
      // Podstawa: krótki skos od ekranu, pionowe boki (z gniazdem), zaokrąglony dół; wycięcie na otwieranie.
      `<path d="M${sx - 10} ${top} H${w - sx + 10} L${w} ${top + 20} V${top + base - 16} a16 16 0 0 1 -16 16 H16 a16 16 0 0 1 -16 -16 V${top + 20} Z" fill="${P.grey}"/>` +
      `<rect x="${w / 2 - 110}" y="${top}" width="220" height="16" rx="8" fill="${P.greyDark}"/>` +
      `<rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" rx="2" fill="${P.ink}" opacity="0.75"/>`,
    parts: {
      'slot-ekran': { x: sx + bezel, y: bezel, w: sw, h: sh },
      port: slot,
    },
  };
};

/**
 * Okno darmowego czatu AI z wklejoną tabelą klientów - dane ROZMYTE (bez żadnych prawdziwych ani zmyślonych danych osobowych).
 * Sloty: `slot-tytul` (nazwa narzędzia), `slot-prosba` (dymek z prośbą użytkownika). Tabela pod dymkiem, rozmyta filtrem.
 */
export const chatWindow: PropFn<{ w?: number; h?: number; bubbleH?: number; bar?: number }> = ({ w = 640, h = 560, bubbleH = 120, bar = BAR }) => {
  const bubble: Rect = { x: w - 30 - Math.round(w * 0.72), y: bar + 24, w: Math.round(w * 0.72), h: bubbleH };
  const table: Rect = { x: 30, y: bubble.y + bubble.h + 28, w: w - 60, h: h - (bubble.y + bubble.h + 28) - 28 };
  const rows = Math.max(3, Math.floor(table.h / 46));
  const rowH = table.h / rows;
  const cols = [0.34, 0.33, 0.33];
  let cells = '';
  for (let r = 0; r < rows; r += 1) {
    let cx = table.x + 14;
    cols.forEach((share, c) => {
      const cw = (table.w - 28) * share;
      const len = 0.45 + (((r * 7 + c * 3) % 5) / 10);
      cells += `<rect x="${cx.toFixed(1)}" y="${(table.y + r * rowH + rowH / 2 - 9).toFixed(1)}" width="${(cw * len).toFixed(1)}" height="18" rx="9" fill="${r === 0 ? P.purpleDark : P.greyDark}"/>`;
      cx += cw;
    });
  }
  // Ikona narzędzia: dymek z iskrą (generyczny „asystent AI”, bez logo).
  const icon = `<path d="M30 30 h28 a6 6 0 0 1 6 6 v14 a6 6 0 0 1 -6 6 h-16 l-8 8 v-8 h-4 a6 6 0 0 1 -6 -6 v-14 a6 6 0 0 1 6 -6 z" fill="${P.teal}"/>` +
    `<path d="M44 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" fill="${P.white}"/>`;
  return {
    w, h,
    svg:
      windowFrame(w, h, P.teal, icon, bar) +
      `<rect x="${bubble.x}" y="${bubble.y}" width="${bubble.w}" height="${bubble.h}" rx="28" fill="${P.sky}"/>` +
      `<defs><filter id="rozmycie" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="7"/></filter></defs>` +
      `<rect x="${table.x}" y="${table.y}" width="${table.w}" height="${table.h}" rx="10" fill="#F1F2F7" stroke="${P.grey}" stroke-width="3"/>` +
      `<g filter="url(#rozmycie)">${cells}</g>`,
    parts: {
      'slot-tytul': titleSlot(w, bar),
      'slot-prosba': { x: bubble.x + 24, y: bubble.y + 10, w: bubble.w - 48, h: bubble.h - 20 },
    },
  };
};

/**
 * Okno prywatnego dysku w chmurze z folderem. Sloty: `slot-tytul` (nazwa usługi), `slot-folder` (nazwa folderu obok ikony folderu).
 */
export const cloudWindow: PropFn<{ w?: number; h?: number; folder?: number; bar?: number }> = ({ w = 480, h = 380, folder = 120, bar = BAR }) => {
  const body = { y: bar + 30, h: h - bar - 60 };
  const fy = body.y + (body.h - folder * 0.8) / 2;
  const icon = `<path d="M26 46 a10 10 0 0 1 10 -12 a14 14 0 0 1 26 -2 a10 10 0 0 1 4 20 h-32 a8 8 0 0 1 -8 -6 z" fill="${P.sky}"/>`;
  return {
    w, h,
    svg:
      windowFrame(w, h, P.purple, icon, bar) +
      `<path d="M30 ${fy} h${folder * 0.42} l${folder * 0.1} ${folder * 0.12} h${folder * 0.48} v${folder * 0.68} h-${folder} z" fill="${P.yellowDark}"/>` +
      `<rect x="30" y="${fy + folder * 0.18}" width="${folder}" height="${folder * 0.62}" rx="6" fill="${P.yellow}"/>`,
    parts: {
      'slot-tytul': titleSlot(w, bar),
      'slot-folder': { x: 30 + folder + 24, y: body.y, w: w - folder - 84, h: body.h },
    },
  };
};

/** Okno dokumentu (raport w edytorze): nagłówek ze slotem `slot-tytul` i szare linie tekstu (bez słów). */
export const docWindow: PropFn<{ w?: number; h?: number; titleH?: number }> = ({ w = 760, h = 560, titleH = 150 }) => {
  const icon = `<rect x="32" y="26" width="24" height="30" rx="4" fill="${P.white}"/><path d="M37 36 h14 M37 42 h14 M37 48 h9" stroke="${P.purpleDark}" stroke-width="3"/>`;
  const linesTop = BAR + 30 + titleH + 24;
  const lines = Math.max(2, Math.floor((h - linesTop - 30) / 44));
  return {
    w, h,
    svg:
      windowFrame(w, h, P.purpleDark, icon, BAR) +
      Array.from({ length: lines }, (_, i) =>
        `<rect x="50" y="${linesTop + i * 44}" width="${(w - 100) * (i === lines - 1 ? 0.55 : 0.85 + ((i * 3) % 3) * 0.05)}" height="16" rx="8" fill="${P.grey}"/>`,
      ).join(''),
    parts: { 'slot-tytul': { x: 50, y: BAR + 30, w: w - 100, h: titleH } },
  };
};

/**
 * Cel dotykowy większy niż rysunek (D-132: ≥ 44 px na scenie odniesienia 480×270) - część `cel` w lokalnych jednostkach, może wychodzić
 * poza klocek (np. ikona razem z podpisem pod nią, pendrive razem z miejscem nad nim).
 */
const targetPart = (target?: Rect) => (target ? { parts: { cel: target } } : {});

/** Ikona pobranego programu na pulpicie: dokument z czerwonym paskiem i strzałką pobierania (bez liter). Bez podpisu - podpis wpala scena. */
export const appIcon: PropFn<{ size?: number; target?: Rect }> = ({ size = 150, target }) => {
  const s = size / 150;
  return {
    ...targetPart(target),
    w: size, h: size * 1.2,
    svg:
      `<g transform="scale(${s})">` +
      `<path d="M14 6 h82 l40 40 v124 a10 10 0 0 1 -10 10 h-112 a10 10 0 0 1 -10 -10 v-154 a10 10 0 0 1 10 -10 z" fill="${P.white}"/>` +
      `<path d="M96 6 v30 a10 10 0 0 0 10 10 h30 z" fill="${P.grey}"/>` +
      `<rect x="4" y="70" width="132" height="44" fill="${P.red}"/>` +
      `<path d="M70 128 v30 M56 146 l14 14 l14 -14" fill="none" stroke="${P.purpleDark}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="122" cy="20" r="18" fill="${P.orange}"/><path d="M122 10 v12 M122 28 v2" stroke="${P.white}" stroke-width="5" stroke-linecap="round"/>` +
      `</g>`,
  };
};

/**
 * Prywatny pendrive: obudowa z kółkiem na smycz (bez smyczy) i diodą, metalowa końcówka USB z dwoma stykami. Wtyk z prawej, koniec na
 * x = w, środek na lokalnym y = PLUG_Y; `flip` - lustrzanie (wtyk z lewej, x = 0). Scena kładzie go POD laptopem tak, żeby ostatnie
 * 12 jednostek wtyku przykryła podstawa (gniazdo `port` klocka `laptopFront`): x = x laptopa + 12 - w (lewy bok) albo x laptopa +
 * szerokość - 12 (prawy, `flip`); y = y laptopa + góra podstawy + PORT_Y - PLUG_Y (= +37 - 40). `len` - długość obudowy.
 * `target` (część `cel`) w lokalnych jednostkach już po odbiciu. Bez napisów.
 */
export const usbStick: PropFn<{ len?: number; flip?: boolean; target?: Rect }> = ({ len = 120, flip = false, target }) => {
  const ring = 16, body = { x: ring + 4, y: PLUG_Y - 24, w: len, h: 48 };
  const tip = { x: body.x + body.w, y: PLUG_Y - 15, w: 36, h: 30 };
  const w = tip.x + tip.w;
  return {
    ...targetPart(target),
    w, h: 80,
    svg:
      (flip ? `<g transform="translate(${w} 0) scale(-1 1)">` : '<g>') +
      // Cień, kółko na smycz (krótkie, przy końcu obudowy), obudowa z ciemniejszą nasadką przy wtyku, otwór na kółko i dioda.
      `<rect x="${body.x + 6}" y="${body.y + 8}" width="${body.w}" height="${body.h}" rx="14" fill="${P.ink}" opacity="0.18"/>` +
      `<circle cx="${ring}" cy="${PLUG_Y}" r="12" fill="none" stroke="${P.greyDark}" stroke-width="5"/>` +
      `<rect x="${body.x}" y="${body.y}" width="${body.w}" height="${body.h}" rx="14" fill="${P.orange}"/>` +
      `<rect x="${body.x + body.w - 22}" y="${body.y}" width="22" height="${body.h}" rx="4" fill="#C9661F"/>` +
      `<circle cx="${body.x + 16}" cy="${PLUG_Y}" r="7" fill="${P.desk}" stroke="#C9661F" stroke-width="3"/>` +
      `<circle cx="${body.x + body.w - 40}" cy="${body.y + 12}" r="4.5" fill="${P.green}"/>` +
      // Metalowa końcówka USB: ramka z jaśniejszym pasem i dwoma prostokątnymi stykami.
      `<rect x="${tip.x}" y="${tip.y}" width="${tip.w}" height="${tip.h}" rx="2" fill="#C8CBDA" stroke="${P.greyDark}" stroke-width="2"/>` +
      `<rect x="${tip.x}" y="${tip.y + 3}" width="${tip.w}" height="5" fill="${P.white}" opacity="0.6"/>` +
      `<rect x="${tip.x + 8}" y="${tip.y + 11}" width="7" height="7" fill="${P.ink}" opacity="0.7"/><rect x="${tip.x + 21}" y="${tip.y + 11}" width="7" height="7" fill="${P.ink}" opacity="0.7"/>` +
      `</g>`,
  };
};

/** Ikony kart skutków (bez słów): serwery obcej firmy, robak w paczce, waga (prawo), folder z krzyżykiem (utrata plików). */
const cardIcon = (kind: number, cx: number, cy: number, s: number) => {
  const g = (inner: string) => `<g transform="translate(${cx} ${cy}) scale(${s})">${inner}</g>`;
  switch (kind) {
    case 0:
      return g(
        [-60, -10, 40].map((y) => `<rect x="-70" y="${y}" width="140" height="40" rx="8" fill="${P.purpleDark}"/><circle cx="-46" cy="${y + 20}" r="7" fill="${P.green}"/><rect x="-20" y="${y + 15}" width="70" height="10" rx="5" fill="${P.grey}"/>`).join('') +
          `<path d="M80 -70 a26 26 0 0 1 0 52" fill="none" stroke="${P.red}" stroke-width="10" stroke-linecap="round"/>`,
      );
    case 1:
      return g(
        `<path d="M-70 -20 l70 -36 l70 36 v76 l-70 36 l-70 -36 z" fill="${P.desk}" stroke="${P.deskDark}" stroke-width="6"/><path d="M-70 -20 l70 36 l70 -36 M0 16 v76" fill="none" stroke="${P.deskDark}" stroke-width="6"/>` +
          `<ellipse cx="20" cy="-50" rx="26" ry="20" fill="${P.green}"/><circle cx="20" cy="-78" r="14" fill="${P.green}"/>` +
          `<path d="M-10 -60 l-18 -8 M-10 -44 l-18 6 M50 -60 l18 -8 M50 -44 l18 6 M12 -90 l-8 -14 M28 -90 l8 -14" stroke="${P.green}" stroke-width="6" stroke-linecap="round"/>`,
      );
    case 2:
      return g(
        `<rect x="-6" y="-80" width="12" height="150" rx="4" fill="${P.purpleDark}"/><rect x="-50" y="66" width="100" height="16" rx="8" fill="${P.purpleDark}"/>` +
          `<rect x="-80" y="-66" width="160" height="10" rx="5" fill="${P.purpleDark}"/>` +
          `<path d="M-70 -56 l-26 60 h52 z M70 -56 l-26 60 h52 z" fill="${P.yellow}" stroke="${P.yellowDark}" stroke-width="4"/>`,
      );
    default:
      return g(
        `<path d="M-80 -50 h56 l14 16 h90 v100 h-160 z" fill="${P.yellowDark}"/><rect x="-80" y="-30" width="160" height="96" rx="8" fill="${P.yellow}"/>` +
          `<path d="M-26 -4 l52 52 M26 -4 l-52 52" stroke="${P.red}" stroke-width="14" stroke-linecap="round"/>`,
      );
  }
};

/**
 * Tablica korkowa z czterema kartami skutków (`cols` × wierszy, karty po kolei 1-4). Części: `karta-1`…`karta-4` (cele dotykowe -
 * cała karta) i `slot-tytul-1`…`slot-tytul-4` (tytuł karty pod ikoną). `iconH` - wysokość pola ikony na karcie.
 */
export const effectsBoard: PropFn<{ w?: number; h?: number; cols?: number; gap?: number; iconH?: number }> = ({ w = 1520, h = 920, cols = 4, gap = 36, iconH = 300 }) => {
  const frame = 26, pad = 40;
  const rows = Math.ceil(4 / cols);
  const cw = (w - 2 * frame - 2 * pad - (cols - 1) * gap) / cols;
  const ch = (h - 2 * frame - 2 * pad - (rows - 1) * gap) / rows;
  const colors = [P.purple, P.green, P.orange, P.red];
  const parts: Record<string, Rect> = {};
  let cards = '';
  for (let i = 0; i < 4; i += 1) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = frame + pad + c * (cw + gap), y = frame + pad + r * (ch + gap);
    // Karty proste (bez obrotu): tytuł wpala scena prostym `textBox` - na obróconej karcie odstawałby od krawędzi.
    const icon = Math.min(iconH, ch * 0.45);
    cards +=
      `<g>` +
      shadow(cw, ch, 10, 8, 10, [x, y]) +
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="10" fill="${P.white}"/>` +
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="18" rx="6" fill="${colors[i]}"/>` +
      `<circle cx="${(x + cw / 2).toFixed(1)}" cy="${(y + 4).toFixed(1)}" r="14" fill="${P.red}"/><circle cx="${(x + cw / 2 - 4).toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${P.white}" opacity="0.7"/>` +
      cardIcon(i, x + cw / 2, y + 40 + icon / 2, icon / 220) +
      `</g>`;
    parts[`karta-${i + 1}`] = { x, y, w: cw, h: ch };
    const titleH = ch - 60 - icon - 30;
    if (titleH < 60) throw new Error(`effectsBoard: za niska karta na tytuł (${Math.round(titleH)} j.) - zwiększ "h" albo zmniejsz "iconH"`);
    parts[`slot-tytul-${i + 1}`] = { x: x + 24, y: y + 60 + icon, w: cw - 48, h: titleH };
  }
  return {
    w, h,
    svg:
      shadow(w, h, 18, 12, 16) +
      `<rect width="${w}" height="${h}" rx="18" fill="${CORK_EDGE}"/>` +
      `<rect x="${frame}" y="${frame}" width="${w - 2 * frame}" height="${h - 2 * frame}" rx="8" fill="${CORK}"/>` +
      Array.from({ length: 40 }, (_, k) => `<circle cx="${(frame + ((k * 137) % (w - 2 * frame))).toFixed(0)}" cy="${(frame + ((k * 89) % (h - 2 * frame))).toFixed(0)}" r="${3 + (k % 3)}" fill="${CORK_EDGE}" opacity="0.35"/>`).join('') +
      cards,
    parts: Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) }])),
  };
};

export const NASKROTY_PROPS = { laptopFront, chatWindow, cloudWindow, docWindow, appIcon, usbStick, effectsBoard };
