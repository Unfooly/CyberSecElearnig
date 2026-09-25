'use client';

import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import type { CourseCompletionReward } from '@/lib/courses-types';

// Licznik XP animowany od 0 (JS, nie CSS - w przeciwieństwie do reszty tego pliku, tekstu liczby nie da się
// animować samym CSS): prefers-reduced-motion sprawdzone WPROST przez matchMedia (nie motion-safe:/motion-reduce:
// - te klasy WYŁĄCZAJĄ WYGLĄD animacji, ale same w sobie nie zatrzymują pętli requestAnimationFrame). Bez
// window (SSR) albo target<=0 (revanche: xpGained zawsze >0 dla prawdziwego ukończenia, ale broni się defensywnie)
// - od razu wynik końcowy, bez pętli.
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) {
      setValue(target);
      return undefined;
    }
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setValue(target);
      return undefined;
    }
    let frameId: number;
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * progress));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    }
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, durationMs]);
  return value;
}

// Pasek poziomu "przed -> po": renderuje się od razu na `beforePercent` (bez animacji), potem w EFEKCIE (jedna
// klatka po zamontowaniu) przechodzi na `afterPercent` - tę zmianę animuje zwykłe przejście CSS (transition-all),
// wyłączone pod prefers-reduced-motion przez motion-reduce:transition-none (ten sam, ustalony w tym repo wzorzec co
// NotesDrawer.tsx/TranscriptPanel.tsx - w przeciwieństwie do licznika XP wyżej, SZEROKOŚĆ da się zatrzymać samym CSS,
// nie trzeba JS-owego sprawdzenia matchMedia). aria-valuenow to zawsze KOŃCOWA wartość (afterPercent), nie
// pośrednia - czytnik ekranu nie ma ogłaszać wartości przejściowych animacji.
function LevelProgressBar({ beforePercent, afterPercent }: { beforePercent: number; afterPercent: number }) {
  const [width, setWidth] = useState(beforePercent);
  useEffect(() => {
    const frameId = requestAnimationFrame(() => setWidth(afterPercent));
    return () => cancelAnimationFrame(frameId);
  }, [afterPercent]);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={afterPercent}
      aria-label="Postęp do następnego poziomu"
      className="h-1.5 w-full overflow-hidden rounded-full border border-slate-200 bg-white"
    >
      <div
        className="h-full rounded-full bg-indigo-600 transition-all duration-700 motion-reduce:transition-none"
        style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
      />
    </div>
  );
}

// Karta nagrody INLINE na SummaryScreen (fix/course-finish-flow) - zastępuje dawny CourseRewardModal.tsx (modal
// nad treścią). `reward` null: user wraca do JUŻ ukończonego kursu później (bez świeżego zapisu w TEJ sesji,
// CoursePlayer.tsx) - żadna karta się nie renderuje, tak jak dawny modal się wtedy nie pokazywał.
export default function RewardCard({ reward }: { reward: CourseCompletionReward | null }) {
  const animatedXp = useCountUp(reward?.xpGained ?? 0);
  if (!reward) return null;

  // Broniony, ale w praktyce nieosiągalny stan przy DZISIEJSZYM apps/api: GamificationService.awardCourseCompletion
  // dolicza co najmniej COURSE_COMPLETION_XP (100) przy KAŻDYM ukończeniu, także powtórce po "Rozpocznij od nowa"
  // (D-069: "awardCourseCompletion nie ma parametru courseId i dolicza XP przy KAŻDYM ukończeniu" - świadomy,
  // udokumentowany wybór, nie coś do naprawienia tutaj). xpGained===0 nigdy dziś nie wychodzi z API - ten branch
  // istnieje dla kontraktu typu (xpGained: number, teoretycznie mogłoby być 0) i na wypadek przyszłej zmiany API.
  if (reward.xpGained === 0) {
    return (
      <div role="status" aria-live="polite" className="mb-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">
        Kurs ukończony ponownie. XP naliczone przy pierwszym ukończeniu.
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg bg-indigo-50 p-4 text-left ring-1 ring-indigo-200">
      <p className="text-center text-2xl font-semibold text-indigo-900">
        +{animatedXp} XP
      </p>

      <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>Poziom {reward.previousLevel}</span>
        {reward.leveledUp && <span>Poziom {reward.newLevel}</span>}
      </div>
      <LevelProgressBar beforePercent={reward.levelProgressBeforePercent} afterPercent={reward.levelProgressAfterPercent} />

      {reward.leveledUp && (
        <p className="mt-3 rounded bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">Awans na poziom {reward.newLevel}!</p>
      )}

      {reward.unlockedBadges.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium text-slate-700">Nowe odznaki:</p>
          {reward.unlockedBadges.map((badge) => (
            <p key={badge.code} className="flex items-center gap-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <Award aria-hidden="true" className="h-4 w-4 shrink-0" />
              {badge.title} (+{badge.xpReward} XP)
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
