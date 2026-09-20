// JEDNO miejsce formatowania dat i godzin w web. Wszystko idzie z JAWNĄ strefą czasową, nigdy z domyślnej strefy procesu:
// serwer (SSR) renderuje zwykle w UTC, a przeglądarka w strefie użytkownika, więc format bez `timeZone` dawał inne godziny
// w SSR i po hydracji (np. 08:33 na liście kampanii vs 10:33 w szczegółach). Wywołania `toLocale*String`, `getHours()`,
// `getTimezoneOffset()` itp. poza tym plikiem są błędem (pilnuje tego test w datetime.test.ts).
//
// Strefa = strefa organizacji (Organization.timezone, IANA). Na teraz helper domyślnie używa stałej Europe/Warsaw;
// przekazanie wartości z ustawień organizacji do renderowania to osobny, następny krok (parametr `timeZone` już jest).

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const LOCALE = 'pl-PL';

/** Data i godzina, np. "20 wrz 2026, 10:33". Brak wartości => podany tekst zastępczy. */
export function formatDateTime(iso: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE, fallback = 'Brak aktywności'): string {
  if (!iso) {
    return fallback;
  }
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

/** Sama data, np. "20 września 2026". */
export function formatDateLong(iso: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long', day: 'numeric', timeZone }).format(new Date(iso));
}

/** Rok kalendarzowy w strefie (stopka: przełom roku nie rozjeżdża SSR i klienta). */
export function formatYear(iso: string | Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(LOCALE, { year: 'numeric', timeZone }).format(new Date(iso));
}

/**
 * 'YYYY-MM' -> np. "wrz 2026". Miesiąc jest już wyliczony po stronie backendu (UTC), więc etykieta celowo jest w UTC -
 * przeliczanie miesiąca na strefę przesunęłoby go o jeden dla granic miesiąca.
 */
export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

// ---- pola <input type="datetime-local"> ---------------------------------------------------------------------------
// Wartość takiego pola to CZAS ŚCIENNY bez strefy ("2026-09-20T10:33"). Interpretujemy go w strefie organizacji (nie
// przeglądarki), żeby okno kampanii znaczyło to samo dla każdego administratora, gdziekolwiek się loguje.

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

/** Przesunięcie strefy względem UTC w ms dla danego momentu (dodatnie na wschód od Greenwich). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Moment w strefie => wartość dla <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"). */
export function isoToZonedInput(iso: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(new Date(iso), timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/**
 * Czas ścienny ("YYYY-MM-DDTHH:mm") w strefie => moment UTC (ISO) albo null przy niepoprawnym tekście. Dwa przybliżenia
 * przesunięcia obsługują zmianę czasu; w "dziurze" wiosennej godzina jest przesuwana do przodu (jak w kalendarzach).
 */
export function zonedInputToIso(local: string, timeZone: string = DEFAULT_TIMEZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Date.UTC "przelewa" nieprawidłowe wartości (miesiąc 13, godzina 25): wymagamy, żeby składniki przeszły rundkę.
  const check = new Date(wallAsUtc);
  if (!Number.isFinite(wallAsUtc) || hour > 23 || minute > 59 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  let guess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  guess = wallAsUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess).toISOString();
}
