// Publiczne śledzenie symulacji (strona lądowania /t/<token>) - wspólne stałe web.

/** Token z linku: 32 losowe bajty w base64url = dokładnie 43 znaki (jak w apps/api). */
export const TRACKING_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

/**
 * Lekcja domyślna - ta sama treść co DEFAULT_LESSON_HTML w apps/api (tracking.service.ts). BFF zwraca ją dla tokenu
 * niepoprawnego formatem BEZ pytania API, więc odpowiedź jest taka sama jak dla tokenu nieznanego (brak enumeracji).
 * Zmieniając treść, zmień obie kopie.
 */
export const DEFAULT_LESSON_HTML =
  '<h2>To była symulacja</h2><p>Ta wiadomość została wysłana w ramach ćwiczenia z rozpoznawania phishingu. ' +
  'Nic złego się nie stało - żadne dane nie zostały zapisane.</p>' +
  '<p>Zanim klikniesz link albo wpiszesz dane, sprawdź nadawcę, adres strony i to, czy wiadomość wywiera presję czasu. ' +
  'W razie wątpliwości zgłoś wiadomość zespołowi bezpieczeństwa.</p>';
