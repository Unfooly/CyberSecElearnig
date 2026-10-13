/**
 * Klocki modułu 3 „Łańcuszek” (tryb prosty, D-132): telefon Oli z rozmową na komunikatorze i ekran logowania bez żadnej marki.
 * Klocki rysują tylko kształty i wystawiają sloty `slot-*` - napisy wpala scena klockami `textBox` ze `strings` (D-135), więc
 * dopasowanie i minimum 16 px na ekranie telefonu (390 px) sprawdza kompozytor. Komunikator generyczny: bez logo, bez nazwy aplikacji.
 *
 * Telefon ma stały rozmiar lokalny 700×1300; cele dotykowe (dymek, karta linku, karta logowania) mają co najmniej 230 jednostek
 * wysokości - przy skali 0,76 w scenie poziomej 1600×1000 to ≥ 44 px na scenie odniesienia 480×270 (D-132).
 *
 * UWAGA: pozycje klocków `textBox` w scenach `examples/lancuszek/{telefon-oli,telefon-oli-pion,logowanie-zoom}.json` są przeliczone ręcznie
 * ze slotów poniżej (x sceny = x elementu + slot.x × skala) - zmiana slotu wymaga poprawki tych trzech scen.
 */
import { P } from './palette.js';
import type { PropFn } from './types.js';

type Rect = { x: number; y: number; w: number; h: number };

const W = 700, H = 1300;
const SCREEN = { x: 36, y: 90, w: 628, h: 1120 };

/** Rama telefonu (front) z ekranem i paskiem stanu bez tekstu (godzina/bateria jako kształty). */
const shell = (screenFill: string) =>
  `<rect x="14" y="18" width="${W}" height="${H}" rx="86" fill="${P.ink}" opacity="0.2"/>` +
  `<rect width="${W}" height="${H}" rx="86" fill="${P.ink}"/>` +
  `<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="44" fill="${screenFill}"/>` +
  `<rect x="${W / 2 - 80}" y="36" width="160" height="26" rx="13" fill="#1B1730"/>` +
  `<rect x="${W / 2 - 110}" y="${H - 52}" width="220" height="10" rx="5" fill="${P.white}" opacity="0.55"/>`;

/** Ikona kłódki (środek 0,0, rozmiar ~ s). */
const lock = (s: number, fill: string) =>
  `<g transform="scale(${s / 100})"><rect x="-34" y="-8" width="68" height="54" rx="10" fill="${fill}"/>` +
  `<path d="M-20 -8 v-14 a20 20 0 0 1 40 0 v14" fill="none" stroke="${fill}" stroke-width="10"/></g>`;

/**
 * Telefon Oli: rozmowa z „Kasią” na komunikatorze. Części (cele sceny): `wiadomosc` (dymek „To Ty na tym filmie?”), `link` (karta
 * linku z miniaturą filmu), `logowanie` (druga wiadomość: ponaglenie do logowania). Sloty tekstu: `slot-kontakt`, `slot-wiadomosc`,
 * `slot-link-tytul`, `slot-link-adres`, `slot-logowanie`, godziny pod wiadomościami `slot-czas-1`, `slot-czas-2`, `slot-czas-3`.
 */
export const chatPhone: PropFn<Record<string, never>> = () => {
  // Trzy wiadomości od Kasi (uwagi właściciela 2026-10-13): dymek dopasowany do dwóch linii tekstu, karta linku, druga wiadomość
  // z prośbą o logowanie (zamiast karty „zaloguj się” wyglądającej jak prośba komunikatora); pod każdą godzina. Cel dotykowy = wiadomość
  // razem z wierszem godziny (≥ 230 jednostek wysokości).
  const bubble: Rect = { x: 70, y: 250, w: 540, h: 180 };
  const link: Rect = { x: 70, y: 500, w: 560, h: 300 };
  const second: Rect = { x: 70, y: 870, w: 560, h: 180 };
  const time = (r: Rect): Rect => ({ x: r.x + r.w - 160, y: r.y + r.h + 4, w: 160, h: 54 });
  const target = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h + 60 });
  const incoming = (r: Rect) =>
    `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="40" fill="${P.white}"/>` +
    `<path d="M${r.x + 6} ${r.y + r.h - 30} l-26 30 l56 -10 z" fill="${P.white}"/>`;
  return {
    w: W, h: H,
    svg:
      shell('#EEF0F8') +
      // Nagłówek rozmowy: strzałka wstecz, awatar (sylwetka, bez inicjału), miejsce na imię; odstęp strzałka-awatar ≥ 20 jednostek.
      `<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="140" rx="44" fill="${P.purpleDark}"/><rect x="${SCREEN.x}" y="${SCREEN.y + 100}" width="${SCREEN.w}" height="40" fill="${P.purpleDark}"/>` +
      `<path d="M84 160 l-26 -24 l26 -24" fill="none" stroke="${P.white}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="158" cy="160" r="44" fill="#F3C9A8"/><circle cx="158" cy="148" r="17" fill="${P.ink}" opacity="0.75"/>` +
      `<path d="M128 192 c0 -26 60 -26 60 0 z" fill="${P.ink}" opacity="0.75"/>` +
      // Wiadomość 1.
      incoming(bubble) +
      // Karta linku: miniatura filmu z przyciskiem odtwarzania, tytuł i adres.
      `<rect x="${link.x}" y="${link.y}" width="${link.w}" height="${link.h}" rx="36" fill="${P.white}"/>` +
      `<rect x="${link.x + 18}" y="${link.y + 18}" width="${link.w - 36}" height="140" rx="22" fill="#3B2F8F"/>` +
      `<circle cx="${link.x + link.w / 2}" cy="${link.y + 88}" r="44" fill="${P.white}" opacity="0.92"/>` +
      `<path d="M${link.x + link.w / 2 - 14} ${link.y + 64} l40 24 l-40 24 z" fill="#3B2F8F"/>` +
      // Wiadomość 2 (prośba o logowanie).
      incoming(second) +
      // Pasek pisania (bez tekstu).
      `<rect x="${SCREEN.x + 24}" y="${SCREEN.y + SCREEN.h - 74}" width="${SCREEN.w - 130}" height="56" rx="28" fill="${P.white}"/>` +
      `<circle cx="${SCREEN.x + SCREEN.w - 54}" cy="${SCREEN.y + SCREEN.h - 46}" r="30" fill="${P.purple}"/>` +
      `<path d="M${SCREEN.x + SCREEN.w - 66} ${SCREEN.y + SCREEN.h - 58} l26 12 l-26 12 z" fill="${P.white}"/>`,
    parts: {
      wiadomosc: target(bubble),
      link: target(link),
      logowanie: target(second),
      'slot-kontakt': { x: 222, y: 120, w: 400, h: 80 },
      'slot-wiadomosc': { x: bubble.x + 30, y: bubble.y + 18, w: bubble.w - 60, h: bubble.h - 36 },
      'slot-czas-1': time(bubble),
      'slot-link-tytul': { x: link.x + 26, y: link.y + 168, w: link.w - 52, h: 60 },
      'slot-link-adres': { x: link.x + 26, y: link.y + 232, w: link.w - 52, h: 52 },
      'slot-czas-2': time(link),
      'slot-logowanie': { x: second.x + 30, y: second.y + 18, w: second.w - 60, h: second.h - 36 },
      'slot-czas-3': time(second),
    },
  };
};

/**
 * Ekran logowania otwarty z linku (zbliżenie): pasek adresu, nagłówek, dwa pola i przycisk - bez logo i nazwy serwisu. Sloty:
 * `slot-adres`, `slot-naglowek`, `slot-pole-login`, `slot-pole-haslo`, `slot-przycisk`.
 */
export const loginScreen: PropFn<Record<string, never>> = () => {
  const field = (y: number) => `<rect x="80" y="${y}" width="540" height="120" rx="22" fill="${P.white}" stroke="${P.grey}" stroke-width="4"/>`;
  return {
    w: W, h: H,
    svg:
      shell(P.screen) +
      // Pasek adresu przeglądarki (kłódka + miejsce na adres).
      `<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="150" rx="44" fill="${P.wall2}"/><rect x="${SCREEN.x}" y="${SCREEN.y + 100}" width="${SCREEN.w}" height="50" fill="${P.wall2}"/>` +
      `<rect x="64" y="128" width="572" height="84" rx="42" fill="${P.white}"/>` +
      `<g transform="translate(108 170)">${lock(32, P.greyDark)}</g>` +
      // Ogólny znak w miejscu logo: szare koło (bez marki).
      `<circle cx="${W / 2}" cy="330" r="62" fill="${P.wall2}"/><circle cx="${W / 2}" cy="316" r="22" fill="${P.grey}"/><path d="M${W / 2 - 38} 372 c0 -40 76 -40 76 0 z" fill="${P.grey}"/>` +
      field(560) + field(720) +
      `<rect x="80" y="890" width="540" height="120" rx="60" fill="${P.purple}"/>`,
    parts: {
      'slot-adres': { x: 136, y: 140, w: 480, h: 60 },
      'slot-naglowek': { x: 70, y: 410, w: 560, h: 130 },
      'slot-pole-login': { x: 110, y: 590, w: 480, h: 60 },
      'slot-pole-haslo': { x: 110, y: 750, w: 480, h: 60 },
      'slot-przycisk': { x: 110, y: 918, w: 480, h: 64 },
    },
  };
};

/** Telefon leżący ekranem do góry z dymkami bez słów - do miniatury modułu (bez tekstu, jedna grafika na wszystkie języki). */
export const chatPhoneIcon: PropFn<Record<string, never>> = () => ({
  w: W, h: H,
  svg:
    shell('#EEF0F8') +
    `<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="140" rx="44" fill="${P.purpleDark}"/><rect x="${SCREEN.x}" y="${SCREEN.y + 100}" width="${SCREEN.w}" height="40" fill="${P.purpleDark}"/>` +
    `<circle cx="150" cy="160" r="44" fill="#F3C9A8"/>` +
    `<rect x="70" y="270" width="420" height="130" rx="40" fill="${P.white}"/>` +
    `<rect x="210" y="440" width="420" height="110" rx="40" fill="${P.purple}"/>` +
    `<rect x="70" y="590" width="560" height="300" rx="36" fill="${P.white}"/><rect x="88" y="608" width="524" height="180" rx="22" fill="#3B2F8F"/>` +
    `<circle cx="350" cy="698" r="46" fill="${P.white}" opacity="0.92"/><path d="M336 674 l40 24 l-40 24 z" fill="#3B2F8F"/>` +
    `<rect x="70" y="930" width="380" height="120" rx="40" fill="${P.white}"/>` +
    `<g class="a-bounce"><circle cx="640" cy="96" r="40" fill="${P.red}"/></g>`,
});

export const LANCUSZEK_PROPS = { chatPhone, loginScreen, chatPhoneIcon };
