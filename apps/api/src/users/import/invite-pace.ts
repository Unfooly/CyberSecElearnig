// Tempo zaproszeń z importu (decyzja właściciela produktu 2026-09-20): kolejka z tempem, rozłożona na kolejne dni w ramach dobowego
// limitu zaproszeń organizacji (INVITE_DAILY_LIMIT_PER_ORG, wspólny z zaproszeniami ręcznymi - limit anty-spamowy zostaje).

/** Dobowy limit zaproszeń na organizację (kroczące 24 h; liczony po wystawionych tokenach zaproszeń/resetów). */
export const INVITE_DAILY_LIMIT_PER_ORG = 300;
/** Job wysyłający zaproszenia z importu działa co tyle minut... */
export const INVITE_RUN_INTERVAL_MINUTES = 5;
/** ...i wysyła najwyżej tyle zaproszeń na organizację w jednym biegu (ok. 240/h: nie zalewamy dostawcy poczty). */
export const INVITE_PER_RUN = 20;
/**
 * Zajęcie do wysyłki (SENDING) starsze niż to i bez wyniku = proces padł w trakcie wysyłki (INTERRUPTED_UNKNOWN: wynik niepewny, nie
 * ponawiamy po cichu). To NIE jest limit czasu wysyłki: każde zaproszenie jest zajmowane tuż przed własną wysyłką, a wysyłka ma
 * timeout dostawcy (kilka sekund, TIMEOUT_UNKNOWN), więc żywa wysyłka nigdy nie dożywa tego progu - wiek zajęcia to czas TEJ wysyłki,
 * nie czas oczekiwania w biegu (jak w wysyłce kampanii, docs/phishing-simulations.md).
 */
export const INVITE_STALE_CLAIM_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ile zaproszeń można wysłać TERAZ. Dwa ograniczenia, mniejsze wygrywa:
 *  - dobowy limit: reszta limitu po odjęciu tokenów z ostatnich 24 h i zaproszeń już zajętych do wysyłki (`inFlight`),
 *  - TEMPO: najwyżej `perRun` zaproszeń w oknie jednego biegu (INVITE_RUN_INTERVAL_MINUTES), liczone po zaproszeniach zajętych
 *    w tym oknie (`claimedRecently`) - dzięki temu tempo nie zależy od tego, ile biegów (instancji, powtórzeń) trafi w to samo okno.
 * Nigdy ujemne.
 */
export function inviteCapacity(dailyLimit: number, tokensLast24h: number, inFlight: number, claimedRecently: number = 0, perRun: number = INVITE_PER_RUN): number {
  return Math.max(0, Math.min(perRun - claimedRecently, dailyLimit - tokensLast24h - inFlight));
}

/** Ile zaproszeń dobowy limit pozwala wysłać jeszcze w ciągu najbliższych 24 h (dla podglądu postępu). */
export function dailyRemaining(dailyLimit: number, tokensLast24h: number): number {
  return Math.max(0, dailyLimit - tokensLast24h);
}

/**
 * Szacowana chwila zakończenia wysyłki. Przybliżenie: zaproszenia mieszczące się w pozostałym dziś limicie idą w tempie biegów
 * (INVITE_PER_RUN co INVITE_RUN_INTERVAL_MINUTES), a reszta po pełnych dobach po dobowy limit. Nie uwzględnia zaproszeń ręcznych
 * wysyłanych w międzyczasie ani wygasania tokenów w oknie kroczącym - to szacunek, nie obietnica. null, gdy nie ma czego wysyłać.
 */
export function estimateInviteCompletion(remaining: number, dailyLeft: number, now: Date, dailyLimit: number = INVITE_DAILY_LIMIT_PER_ORG): Date | null {
  if (remaining <= 0) return null;
  const sendableNow = Math.min(remaining, dailyLeft);
  const runs = Math.ceil(sendableNow / INVITE_PER_RUN);
  const restAfterToday = remaining - sendableNow;
  if (restAfterToday <= 0) {
    return new Date(now.getTime() + runs * INVITE_RUN_INTERVAL_MINUTES * 60_000);
  }
  // Reszta czeka na zwolnienie limitu kroczącego okna: pełne doby po dobowy limit, plus czas przesłania ostatniej porcji.
  const days = Math.ceil(restAfterToday / dailyLimit);
  return new Date(now.getTime() + days * DAY_MS);
}
