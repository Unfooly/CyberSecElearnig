/**
 * Klocki modułu 4 „Na skróty” (shadow IT, tryb prosty, D-132): laptop Bartka, okna darmowych narzędzi (czat AI, prywatny dysk w chmurze),
 * ikona programu z internetu, prywatny pendrive (dziś tylko miniatura modułu, D-201) i tablica z kartami skutków. Scena biurka i klocek
 * okna dokumentu usunięte w B-183. Klocki rysują tylko kształty i wystawiają sloty
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
/** Tablica skutków ze zdjęciami (`photoBoard`): kolory jak ciemne wnętrza grafik Dreaminy modułu. */
const BOARD_BG = '#16161B';
const BOARD_CARD = '#24242C';
const BOARD_PHOTO = '#33333D';
/** Promień rogów okna zdjęcia - ten sam w masce zdjęcia (photo-fill.ts). */
export const PHOTO_RX = 12;

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

/**
 * Tablica czterech kart skutków ze zdjęciami (D-208, uwaga właściciela 2026-11-23: grafiki z Dreaminy jak w reszcie modułu, zamiast
 * rysowanej tablicy korkowej). Ciemne tło jak grafiki Dreaminy; karty `cols` × wierszy, po kolei 1-4. Części: `karta-1`…`karta-4` (cele
 * dotykowe - cała karta), `foto-1`…`foto-4` (kwadratowe okno zdjęcia: `photo: 'left'` przy lewej krawędzi, `'top'` u góry) i
 * `slot-tytul-1`…`slot-tytul-4`. SVG sceny nie osadza obrazów (bez `href`, test w odprawa.test.ts) - zdjęcia wkleja w okna `foto-*`
 * dopiero `photo-fill.ts`, który zapisuje gotową scenę jako WebP.
 */
export const photoBoard: PropFn<{ w?: number; h?: number; cols?: number; gap?: number; photo?: 'left' | 'top' }> = ({ w = 1520, h = 920, cols = 2, gap = 36, photo = 'left' }) => {
  const pad = 40, inset = 20;
  const rows = Math.ceil(4 / cols);
  const cw = (w - 2 * pad - (cols - 1) * gap) / cols;
  const ch = (h - 2 * pad - (rows - 1) * gap) / rows;
  const parts: Record<string, Rect> = {};
  let cards = '';
  for (let i = 0; i < 4; i += 1) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = pad + c * (cw + gap), y = pad + r * (ch + gap);
    // Okno zdjęcia: kwadrat przy lewej albo górnej krawędzi karty; tytuł w pozostałym miejscu.
    const side = photo === 'left' ? ch - 2 * inset : cw - 2 * inset;
    const foto: Rect = { x: x + inset, y: y + inset, w: side, h: side };
    const title: Rect =
      photo === 'left'
        ? { x: foto.x + side + 28, y: y + inset, w: cw - side - 2 * inset - 28, h: ch - 2 * inset }
        : { x: x + inset, y: foto.y + side + 20, w: cw - 2 * inset, h: ch - side - 2 * inset - 20 };
    if (title.w < 160 || title.h < 120) throw new Error(`photoBoard: za mało miejsca na tytuł karty (${Math.round(title.w)}×${Math.round(title.h)} j.)`);
    cards +=
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="18" fill="${BOARD_CARD}" stroke="${P.purple}" stroke-opacity="0.55" stroke-width="3"/>` +
      `<rect x="${foto.x.toFixed(1)}" y="${foto.y.toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="${PHOTO_RX}" fill="${BOARD_PHOTO}"/>`;
    parts[`karta-${i + 1}`] = { x, y, w: cw, h: ch };
    parts[`foto-${i + 1}`] = foto;
    parts[`slot-tytul-${i + 1}`] = title;
  }
  return {
    w, h,
    svg: `<rect width="${w}" height="${h}" rx="24" fill="${BOARD_BG}"/>` + cards,
    parts: Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1) }])),
  };
};

export const NASKROTY_PROPS = { laptopFront, chatWindow, cloudWindow, appIcon, usbStick, photoBoard };
