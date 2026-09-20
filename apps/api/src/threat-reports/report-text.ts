// Czyste funkcje przetwarzania tekstu zgłoszeń (bez bazy): sanityzacja, maskowanie linków śledzących, normalizacja
// tematu i nadawcy. Testy: report-text.spec.ts.

// Token odbiorcy w linku symulacji: 43 znaki base64url po "/t/" (patrz buildTrackingUrl). Lookahead: token to CAŁY
// segment (dłuższy ciąg to nie nasz token). Ukośnik może być też zakodowany: %2F (linki przepisane przez Safe Links,
// Proofpoint itp.: ?url=https%3A%2F%2Fhost%2Ft%2F<token>), encja HTML (&#47; / &#x2F;) albo JSON-owy \/ - bez tego
// surowy token trafiłby do skrzynki zgłoszeń i dałoby się nim "kliknąć" za kolegę. Wielkość liter nieistotna.
const SLASH = String.raw`(?:\/|%2F|&#0*47;|&#x0*2F;|\\\/)`;
const TRACKING_TOKEN_IN_TEXT = new RegExp(`${SLASH}t${SLASH}([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])`, 'gi');
export const TOKEN_MASK = '/t/[token-usuniety]';

/**
 * Kopia tekstu do skanowania: NFKC (pełnoszerokie "／" itp.) i sklejone miękkie łamania quoted-printable ("=\n" w środku
 * tokenu). Nie zmienia tekstu, który zapisujemy, dopóki nie znajdzie się w nim token (wtedy zapisujemy wersję po maskowaniu).
 */
const scanCopy = (text: string) => text.replace(/=\n/g, '').normalize('NFKC');
/** Ile różnych tokenów z jednego zgłoszenia sprawdzamy (zgłoszenie z setkami linków to nie pojedynczy mail). */
export const MAX_TOKENS_PER_REPORT = 10;

/**
 * Tekst zgłoszenia jako czysty tekst: NFC, CR/CRLF -> LF, bez znaków NUL i sterujących (poza \n i \t) oraz bez znaków
 * formatujących Unicode (\p{Cf}: m.in. nadpisania kierunku pisma i znaki zerowej szerokości, którymi da się fałszować
 * treść w panelu). HTML nie jest interpretowany nigdzie - pole jest wyświetlane wyłącznie jako tekst.
 */
export function sanitizePlainText(value: string, options: { multiline: boolean }): string {
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n');
  const cleaned = options.multiline
    ? normalized.replace(/[^\P{Cc}\n\t]/gu, '').replace(/\p{Cf}/gu, '')
    : normalized.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ');
  return cleaned.trim();
}

/** Różne tokeny linków śledzących znalezione w tekstach (kolejność pierwszego wystąpienia, z limitem). */
export function extractTrackingTokens(...texts: (string | undefined | null)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of scanCopy(text).matchAll(TRACKING_TOKEN_IN_TEXT)) {
      found.add(match[1]);
      if (found.size >= MAX_TOKENS_PER_REPORT) return [...found];
    }
  }
  return [...found];
}

/** Maskuje linki śledzące: token cudzego odbiorcy nie może trafić do skrzynki zgłoszeń (dałoby się nim "kliknąć" za kogoś). */
export function maskTrackingTokens(text: string): string {
  const scan = scanCopy(text);
  const masked = scan.replace(TRACKING_TOKEN_IN_TEXT, TOKEN_MASK);
  // Bez tokenu zwracamy oryginał (bez zmian NFKC / sklejania łamań); .test() na regexie z flagą g miałoby stan (lastIndex).
  return masked === scan ? text : masked;
}

// Prefiksy odpowiedzi/przekazania dodawane przez klienty poczty (PL/EN/DE).
const SUBJECT_PREFIX = /^\s*(re|fw|fwd|odp|pd|wg|aw|wtr)\s*:\s*/i;

/** Temat do porównania: NFKC, małe litery, bez powtarzanych prefiksów Re:/Fwd:/Odp:/PD:, białe znaki zwinięte. */
export function normalizeSubject(subject: string): string {
  let result = subject.normalize('NFKC');
  for (let i = 0; i < 10 && SUBJECT_PREFIX.test(result); i += 1) {
    result = result.replace(SUBJECT_PREFIX, '');
  }
  return result.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const ANGLE_ADDRESS = /<\s*([^<>\s@]+@[^<>\s@]+)\s*>/;
const BARE_ADDRESS = /^[^<>\s@"]+@[^<>\s@"]+$/;

/**
 * Adres nadawcy z tego, co wpisał pracownik: "Nazwa <adres>" albo sam adres. Zwraca adres małymi literami albo null,
 * gdy nie da się go jednoznacznie wskazać (np. same imię i nazwisko). Nadawcy nie "zgadujemy" z fragmentów tekstu.
 */
export function extractSenderAddress(sender: string): string | null {
  const text = sender.normalize('NFKC').trim();
  const angle = ANGLE_ADDRESS.exec(text);
  if (angle) return angle[1].toLowerCase();
  return BARE_ADDRESS.test(text) ? text.toLowerCase() : null;
}
