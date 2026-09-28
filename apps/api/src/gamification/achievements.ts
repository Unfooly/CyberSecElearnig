import { ACHIEVEMENT_CODES, AchievementCode, CURIOUS_DETECTIVE_EASTER_EGG, MODULE_1_SLUG } from './gamification.constants';

// Warunki osiągnięć (D-111) jako czyste funkcje - jedno źródło prawdy dla przyznania „na żywo” (ukończenie kursu, zapis bloku)
// i dla przyznania wstecznego (GamificationService.syncAchievements). Katalog (nazwy, opisy, grafiki) jest w bazie.

export interface CompletionFacts {
  // Liczba UKOŃCZONYCH przypisań użytkownika (z tym właśnie ukończonym; także zarchiwizowane restartem - D-069).
  completedCount: number;
  // Wynik tego podejścia 0..100 (null, gdy kurs bez bloków ocenianych).
  score: number | null;
  courseSlug: string | null;
  // Dowody zebrane w tym podejściu (liczy serwer: evidenceSummary).
  evidence: { collected: number; total: number };
}

/** Osiągnięcia za ukończenie kursu: pierwsza sprawa (dowolny kurs) i sprawa bez skazy (moduł 1: komplet dowodów + 100%). */
export function completionAchievements(facts: CompletionFacts): AchievementCode[] {
  const codes: AchievementCode[] = [];
  if (facts.completedCount >= 1) codes.push(ACHIEVEMENT_CODES.FIRST_CASE_CLOSED);
  if (
    facts.courseSlug === MODULE_1_SLUG &&
    facts.score === 100 &&
    facts.evidence.total > 0 &&
    facts.evidence.collected === facts.evidence.total
  ) {
    codes.push(ACHIEVEMENT_CODES.FLAWLESS_CASE);
  }
  return codes;
}

/** Osiągnięcia za wyróżnienia easter egga zapisane przez serwer w postępie bloku (`easterEggs`, D-100). */
export function easterEggAchievements(courseSlug: string | null, easterEggs: readonly string[] | undefined): AchievementCode[] {
  if (courseSlug === MODULE_1_SLUG && easterEggs?.includes(CURIOUS_DETECTIVE_EASTER_EGG)) return [ACHIEVEMENT_CODES.CURIOUS_DETECTIVE];
  return [];
}
