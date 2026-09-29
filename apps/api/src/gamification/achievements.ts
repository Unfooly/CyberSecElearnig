import { evidenceSummary } from '../courses/client-view';
import type { ProgressV2 } from '../courses/progress';
import { Block, liveCallDetail } from '../courses/scoring/evaluate';
import {
  ACHIEVEMENT_CODES,
  AchievementCode,
  CURIOUS_DETECTIVE_EASTER_EGG,
  DEAD_AIR_MAX_STEPS,
  MODULE_1_SLUG,
  MODULE_2_SLUG,
  OFF_THE_RECORD_ENDING,
} from './gamification.constants';

// Warunki osiągnięć (D-111, D-124) jako czyste funkcje - jedno źródło prawdy dla przyznania „na żywo” (ukończenie kursu, zapis bloku)
// i dla przyznania wstecznego (GamificationService.syncAchievements). Katalog (nazwy, opisy, grafiki) jest w bazie.

/**
 * Fakty z przebiegu modułu 2 liczone z postępu i treści wersji kursu (serwer - klient niczego tu nie deklaruje poza tym, co przeszło
 * ocenę bloków). `fullEvidence` liczy WSZYSTKIE dowody z treści, łącznie z ukrytymi do zebrania (sprzeczności przesłuchania, obszary OSINT) -
 * licznik gracza (evidenceSummary) ukrytych nie widzi, dopóki ich nie zbierze, więc sam nie wystarcza do „kompletu” (warunek z D-120).
 */
export interface Module2Facts {
  deadAir: boolean;
  perfectPitch: boolean;
  fullEvidence: { collected: number; total: number };
}

export interface CompletionFacts {
  // Liczba UKOŃCZONYCH przypisań użytkownika (z tym właśnie ukończonym; także zarchiwizowane restartem - D-069).
  completedCount: number;
  // Wynik tego podejścia 0..100 (null, gdy kurs bez bloków ocenianych).
  score: number | null;
  courseSlug: string | null;
  // Dowody zebrane w tym podejściu (liczy serwer: evidenceSummary).
  evidence: { collected: number; total: number };
  // Moduł 2 (D-124): fakty z bloków; bez nich (inne kursy, brak treści) - bez osiągnięć modułu 2.
  module2?: Module2Facts;
}

/**
 * Osiągnięcia za ukończenie kursu: pierwsza sprawa (dowolny kurs), sprawa bez skazy (moduł 1: komplet dowodów + 100%), w module 2 -
 * Dead Air, Perfect Pitch i Full Transcript (komplet dowodów z ukrytymi + 100%). Przyznawane przy ukończeniu (karta nagrody pokazuje je
 * razem z XP), choć Dead Air i Perfect Pitch dotyczą jednego bloku.
 */
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
  if (facts.courseSlug === MODULE_2_SLUG && facts.module2) {
    const { deadAir, perfectPitch, fullEvidence } = facts.module2;
    if (deadAir) codes.push(ACHIEVEMENT_CODES.DEAD_AIR);
    if (perfectPitch) codes.push(ACHIEVEMENT_CODES.PERFECT_PITCH);
    if (facts.score === 100 && fullEvidence.total > 0 && fullEvidence.collected === fullEvidence.total) {
      codes.push(ACHIEVEMENT_CODES.FULL_TRANSCRIPT);
    }
  }
  return codes;
}

/** Osiągnięcia za wyróżnienia easter egga zapisane przez serwer w postępie bloku (`easterEggs`, D-100). */
export function easterEggAchievements(courseSlug: string | null, easterEggs: readonly string[] | undefined): AchievementCode[] {
  if (courseSlug === MODULE_1_SLUG && easterEggs?.includes(CURIOUS_DETECTIVE_EASTER_EGG)) return [ACHIEVEMENT_CODES.CURIOUS_DETECTIVE];
  return [];
}

/** Off the Record (D-120/D-124): ukryte zakończenie webinaru zapisane przez serwer w postępie bloku OSINT (`secretEndings`). Bez XP. */
export function secretEndingAchievements(courseSlug: string | null, secretEndings: readonly string[] | undefined): AchievementCode[] {
  if (courseSlug === MODULE_2_SLUG && secretEndings?.includes(OFF_THE_RECORD_ENDING)) return [ACHIEVEMENT_CODES.OFF_THE_RECORD];
  return [];
}

/**
 * Fakty modułu 2 z postępu i treści (obronnie - uszkodzony wpis albo treść nie może zablokować ukończenia ani profilu):
 *  - Dead Air: ukończona rozmowa na żywo z zakończeniem `good`, bez odpowiedzi oddających informację i najwyżej 3 kroki ścieżki
 *    (dobre zakończenie = rozłączenie/oddzwonienie, D-122); tryb czasu bez znaczenia;
 *  - Perfect Pitch: ukończony odsłuch nagrania - wszystkie flagi z treści trafione i zero fałszywych tapnięć;
 *  - komplet dowodów: wszystkie dowody z treści (z ukrytymi) w notatkach postępu.
 */
export function module2Facts(progress: ProgressV2, blocks: readonly Block[]): Module2Facts {
  let deadAir = false;
  let perfectPitch = false;
  for (const block of blocks) {
    // Postęp czytany obronnie (jak syncAchievements) - pola sprawdzane typem w miejscu użycia.
    const entry = progress.blocks[block.id] as unknown as (Record<string, unknown> & { done?: boolean }) | undefined;
    if (!entry || entry.done !== true) continue;
    if (block.type === 'LIVE_CALL' && Array.isArray(entry.path)) {
      const path = entry.path.filter((step): step is string => typeof step === 'string');
      const detail = liveCallDetail(block, path);
      if (detail && detail.outcome === 'good' && detail.gaveInfo.length === 0 && path.length <= DEAD_AIR_MAX_STEPS) deadAir = true;
    }
    if (block.type === 'CALL_RECORDING' && Array.isArray(entry.flagsHit) && entry.falseTaps === 0) {
      const flags = Array.isArray(block.flags) ? (block.flags as { segmentId?: unknown }[]) : [];
      const hit = new Set(entry.flagsHit);
      if (flags.length > 0 && flags.every((flag) => hit.has(flag.segmentId))) perfectPitch = true;
    }
  }
  const { collected, total } = evidenceSummary(progress, blocks, { includeHidden: true });
  return { deadAir, perfectPitch, fullEvidence: { collected, total } };
}
