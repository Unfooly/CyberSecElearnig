/**
 * Klocki modułu 3 (tryb prosty, D-132), wersja D-203 („Komunikatory i SMS-y”): `strangerChatPhone` (rozmowa z „Martą”), `smsPhone`
 * (smishing) i `chatPhoneIcon` (miniatura). Klocki poprzedniej wersji (`chatPhone`, `loginScreen`) usunięte w B-184.
 * Klocki rysują tylko kształty i wystawiają sloty `slot-*` - napisy wpala scena klockami `textBox` ze `strings` (D-135), więc
 * dopasowanie i minimum 16 px na ekranie telefonu (390 px) sprawdza kompozytor. Komunikator generyczny: bez logo, bez nazwy aplikacji.
 *
 * Telefon ma stały rozmiar lokalny 700×1300; cele dotykowe mają co najmniej 230 jednostek wysokości - przy skali 0,76 w scenie poziomej
 * 1600×1000 to ≥ 44 px na scenie odniesienia 480×270 (D-132).
 *
 * UWAGA: pozycje klocków `textBox` w scenach `examples/lancuszek/{komunikator,komunikator-pion,sms,sms-pion}.json` (D-203) są przeliczone
 * ręcznie ze slotów poniżej (x sceny = x elementu + slot.x × skala; telefon poziomo: x 534, y 6, skala 0,76; pionowo: x 47,5, y 52,
 * skala 1,15) - zmiana slotu wymaga poprawki tych scen.
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

/** Nagłówek rozmowy: fioletowy pasek ze strzałką wstecz i awatarem-sylwetką (miejsce na nazwę: x 222, y 120, 400×80). */
const chatHeader = (fill: string) =>
  `<rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="140" rx="44" fill="${fill}"/><rect x="${SCREEN.x}" y="${SCREEN.y + 100}" width="${SCREEN.w}" height="40" fill="${fill}"/>` +
  `<path d="M84 160 l-26 -24 l26 -24" fill="none" stroke="${P.white}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="158" cy="160" r="44" fill="#F3C9A8"/><circle cx="158" cy="148" r="17" fill="${P.ink}" opacity="0.75"/>` +
  `<path d="M128 192 c0 -26 60 -26 60 0 z" fill="${P.ink}" opacity="0.75"/>`;

/** Pasek pisania na dole ekranu (bez tekstu). */
const composer = () =>
  `<rect x="${SCREEN.x + 24}" y="${SCREEN.y + SCREEN.h - 74}" width="${SCREEN.w - 130}" height="56" rx="28" fill="${P.white}"/>` +
  `<circle cx="${SCREEN.x + SCREEN.w - 54}" cy="${SCREEN.y + SCREEN.h - 46}" r="30" fill="${P.purple}"/>` +
  `<path d="M${SCREEN.x + SCREEN.w - 66} ${SCREEN.y + SCREEN.h - 58} l26 12 l-26 12 z" fill="${P.white}"/>`;

/**
 * Moduł 3 według nagrania „Usługi przesyłania wiadomości” (D-203): rozmowa Oli z „Martą” w nowym komunikatorze. Cztery cele sceny
 * (każdy ≥ 230 jednostek wysokości, jak w `smsPhone`): `profil` (nagłówek z nazwą + pasek „numeru nie ma w kontaktach”), `pytania`
 * (wiadomość od „Marty” z pytaniami o pracę), `odpowiedz` (wysłana odpowiedź Oli z prywatną informacją), `plik` (karta pliku).
 * Sloty: `slot-kontakt`, `slot-baner`, `slot-pytania`, `slot-czas-1`, `slot-odpowiedz`, `slot-czas-2`, `slot-plik-nazwa`,
 * `slot-plik-opis`, `slot-czas-3`.
 */
export const strangerChatPhone: PropFn<Record<string, never>> = () => {
  const banner: Rect = { x: 90, y: 248, w: 520, h: 70 };
  const ask: Rect = { x: 70, y: 350, w: 540, h: 170 };
  const reply: Rect = { x: 90, y: 600, w: 540, h: 170 };
  const file: Rect = { x: 70, y: 850, w: 560, h: 196 };
  const time = (r: Rect): Rect => ({ x: r.x + r.w - 160, y: r.y + r.h + 4, w: 160, h: 54 });
  const target = (r: Rect, extra = 60): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h + extra });
  const icon = { x: file.x + 26, y: file.y + 30 };
  return {
    w: W, h: H,
    svg:
      shell('#EEF0F8') +
      chatHeader(P.purpleDark) +
      // Pasek systemowy: „Nieznany numer” (żółtawe tło ostrzeżenia, bez ikony z tekstem).
      `<rect x="${banner.x}" y="${banner.y}" width="${banner.w}" height="${banner.h}" rx="35" fill="#FFF4D6"/>` +
      // Wiadomość od „Marty” (przychodząca, z ogonkiem z lewej).
      `<rect x="${ask.x}" y="${ask.y}" width="${ask.w}" height="${ask.h}" rx="40" fill="${P.white}"/>` +
      `<path d="M${ask.x + 6} ${ask.y + ask.h - 30} l-26 30 l56 -10 z" fill="${P.white}"/>` +
      // Odpowiedź Oli (wysłana, fioletowa, z ogonkiem z prawej).
      `<rect x="${reply.x}" y="${reply.y}" width="${reply.w}" height="${reply.h}" rx="40" fill="#DCD6FF"/>` +
      `<path d="M${reply.x + reply.w - 6} ${reply.y + reply.h - 30} l26 30 l-56 -10 z" fill="#DCD6FF"/>` +
      // Karta pliku: ikona dokumentu z zagiętym rogiem (niebieska, bez litery) i miejsce na nazwę i opis.
      `<rect x="${file.x}" y="${file.y}" width="${file.w}" height="${file.h}" rx="36" fill="${P.white}"/>` +
      `<path d="M${icon.x} ${icon.y} h86 l40 40 v96 h-126 z" fill="#2F6FD6"/><path d="M${icon.x + 86} ${icon.y} v40 h40 z" fill="#9DBDF2"/>` +
      `<rect x="${icon.x + 22}" y="${icon.y + 70}" width="82" height="10" rx="5" fill="${P.white}" opacity="0.85"/>` +
      `<rect x="${icon.x + 22}" y="${icon.y + 94}" width="62" height="10" rx="5" fill="${P.white}" opacity="0.85"/>` +
      composer(),
    parts: {
      // Nagłówek z paskiem: od góry ekranu do dołu paska (+12) - 240 jednostek.
      profil: { x: SCREEN.x, y: SCREEN.y, w: SCREEN.w, h: banner.y + banner.h + 12 - SCREEN.y },
      pytania: target(ask),
      odpowiedz: target(reply),
      plik: target(file, 64),
      'slot-kontakt': { x: 222, y: 120, w: 400, h: 80 },
      'slot-baner': { x: banner.x + 24, y: banner.y + 8, w: banner.w - 48, h: banner.h - 16 },
      'slot-pytania': { x: ask.x + 30, y: ask.y + 16, w: ask.w - 60, h: ask.h - 32 },
      'slot-czas-1': time(ask),
      'slot-odpowiedz': { x: reply.x + 30, y: reply.y + 16, w: reply.w - 60, h: reply.h - 32 },
      'slot-czas-2': time(reply),
      'slot-plik-nazwa': { x: icon.x + 150, y: file.y + 40, w: file.w - 210, h: 60 },
      'slot-plik-opis': { x: icon.x + 150, y: file.y + 108, w: file.w - 210, h: 52 },
      'slot-czas-3': time(file),
    },
  };
};

/**
 * SMS z fałszywym ostrzeżeniem o koncie (smishing, D-203). Cele (≥ 230 jednostek): `nadawca` (nagłówek z nazwą nadawcy + data),
 * `presja` (zdanie z groźbą i terminem), `link` (skrócony link), `stop` (prośba o odpisanie na numer specjalny) - trzy wiersze jednej
 * wiadomości. Sloty: `slot-nadawca`, `slot-data`, `slot-presja`, `slot-link`, `slot-stop`.
 */
export const smsPhone: PropFn<Record<string, never>> = () => {
  // Szeroka pigułka daty: miejsce na tekst o 35% dłuższy (pseudo-lokalizacja, D-143).
  const dateRow: Rect = { x: 180, y: 254, w: 340, h: 56 };
  const bubble: Rect = { x: 70, y: 350, w: 560, h: 760 };
  const row = (i: number): Rect => ({ x: bubble.x, y: bubble.y + 10 + i * 250, w: bubble.w, h: 240 });
  const slot = (r: Rect): Rect => ({ x: r.x + 30, y: r.y + 14, w: r.w - 60, h: r.h - 28 });
  return {
    w: W, h: H,
    svg:
      shell('#F4F5FA') +
      chatHeader('#3B4A6B') +
      `<rect x="${dateRow.x}" y="${dateRow.y}" width="${dateRow.w}" height="${dateRow.h}" rx="28" fill="#E1E4EE"/>` +
      `<rect x="${bubble.x}" y="${bubble.y}" width="${bubble.w}" height="${bubble.h}" rx="40" fill="${P.white}"/>` +
      `<path d="M${bubble.x + 6} ${bubble.y + bubble.h - 30} l-26 30 l56 -10 z" fill="${P.white}"/>` +
      // Delikatne linie między częściami wiadomości (pomagają trafić w wiersz, wiadomość nadal jedna).
      `<rect x="${bubble.x + 30}" y="${row(1).y - 6}" width="${bubble.w - 60}" height="2" fill="#E6E8F0"/>` +
      `<rect x="${bubble.x + 30}" y="${row(2).y - 6}" width="${bubble.w - 60}" height="2" fill="#E6E8F0"/>` +
      composer(),
    parts: {
      nadawca: { x: SCREEN.x, y: SCREEN.y, w: SCREEN.w, h: dateRow.y + dateRow.h + 12 - SCREEN.y },
      presja: row(0),
      link: row(1),
      stop: row(2),
      'slot-nadawca': { x: 222, y: 120, w: 400, h: 80 },
      'slot-data': { x: dateRow.x + 16, y: dateRow.y + 6, w: dateRow.w - 32, h: dateRow.h - 12 },
      'slot-presja': slot(row(0)),
      'slot-link': slot(row(1)),
      'slot-stop': slot(row(2)),
    },
  };
};

export const LANCUSZEK_PROPS = { chatPhoneIcon, strangerChatPhone, smsPhone };
