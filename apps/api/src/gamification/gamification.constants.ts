// Kody osiągnięć (D-111) - muszą być zgodne z `code` w katalogu `badges`, który wstawia migracja
// 20260928200000_achievements (i dla środowisk deweloperskich prisma/seed-badges.ts). Jeśli wpisu katalogu nie ma,
// GamificationService.tryUnlockBadge po cichu go pomija (nie wywala flow ukończenia kursu z powodu brakujących danych).
export const ACHIEVEMENT_CODES = {
  FIRST_CASE_CLOSED: 'first-case-closed',
  FLAWLESS_CASE: 'flawless-case',
  CURIOUS_DETECTIVE: 'curious-detective',
  // Moduł 2 (D-124, katalog: migracja 20260929200100_module2_achievements).
  DEAD_AIR: 'dead-air',
  PERFECT_PITCH: 'perfect-pitch',
  FULL_TRANSCRIPT: 'full-transcript',
  OFF_THE_RECORD: 'off-the-record',
  // D-202: moduł 4 na 100% i postęp w całym kursie (katalog: migracja 20261122200000_progress_achievements).
  ASK_IT_FIRST: 'ask-it-first',
  THREE_CASES: 'three-cases',
  ALL_CASES: 'all-cases',
} as const;

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[keyof typeof ACHIEVEMENT_CODES];

// Osiągnięcia modułu 1 („Zabawa w phishing”, do D-170 „Wyłudzone hasło”): moduł rozpoznajemy po `Course.slug` (stały klucz importu treści, D-062),
// easter egg po id wyróżnienia z treści (`media.badge.id`, D-100) zapisanym przez serwer w postępie (`easterEggs`).
export const MODULE_1_SLUG = 'wyludzone-haslo';
// Moduł 2 („Vishing”, do D-172 „Głos z helpdesku”; D-124): osiągnięcia z rozmowy na żywo, odsłuchu nagrania, kompletu dowodów i ukrytego zakończenia webinaru.
export const MODULE_2_SLUG = 'glos-z-helpdesku';
// Moduł 4 („Na skróty”, shadow IT; D-201) - „Najpierw pytam IT” za 100% w jednym podejściu (D-202).
export const MODULE_4_SLUG = 'na-skroty';
// „Trzy sprawy” (D-202): tyle RÓŻNYCH ukończonych modułów (powtórka tego samego modułu się nie liczy).
export const THREE_CASES_COUNT = 3;
// Id ukrytego zakończenia webinaru (OSINT `spots[].media.secretEnding.id`, D-120) zapisanego przez serwer w postępie (`secretEndings`).
export const OFF_THE_RECORD_ENDING = 'off-the-record';
// Dead Air: rozłączenie „w pierwszych 3 wyborach” - dobre zakończenie po najwyżej tylu krokach ścieżki (D-122).
export const DEAD_AIR_MAX_STEPS = 3;

// Wersja zasad przyznania wstecznego (users.achievementsSyncVersion): podbij przy NOWYM osiągnięciu, którego warunek mógł być
// spełniony wcześniej - każdy użytkownik przejdzie wtedy backfill jeszcze raz (idempotentnie). 2 - osiągnięcia modułu 2 (D-124);
// 3 - Sprawa bez skazy i Full Transcript bez warunku dowodów (D-174): kto miał już 100% bez kompletu dowodów, dostaje je wstecznie.
// 4 - D-202: Najpierw pytam IT, Trzy sprawy, Komplet (kto już spełnił warunek, dostaje je wstecznie).
export const ACHIEVEMENTS_SYNC_VERSION = 4;
export const CURIOUS_DETECTIVE_EASTER_EGG = 'ciekawski-detektyw';

export const COURSE_COMPLETION_XP = 100;
export const PERFECT_SCORE_XP = 50;

// Ranking organizacji (D-112): pierwsza dziesiątka + pozycja pytającego.
export const LEADERBOARD_LIMIT = 10;

// Przypięte osiągnięcia na profilu i przy nazwisku w rankingu (D-112).
export const MAX_PINNED_ACHIEVEMENTS = 3;
export const PIN_LIMIT_MESSAGE = 'Możesz przypiąć maksymalnie 3 odznaki.';

// Neutralna grafika tajnego osiągnięcia (ta sama co zablokowana na profilu) - dla przypiętego tajnego u osoby, która go nie zdobyła.
export const SECRET_LOCKED_ICON = 'osiagniecie-tajne-zablokowane';

export type LeaderboardScope = 'organization' | 'department';
