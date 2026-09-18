'use client';

import { useEffect } from 'react';
import type { CourseCompletionReward } from '@/lib/courses-types';

export default function CourseRewardModal({
  reward,
  onClose,
}: {
  reward: CourseCompletionReward;
  onClose: () => void;
}) {
  // a11y: Escape zamyka modal (WAI-ARIA dialog pattern) - jedyny sposób
  // zamknięcia bez myszki, dopóki nie ma pełnego focus trapu w tym repo.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-reward-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-lg">
        <p className="mb-1 text-3xl">🎉</p>
        <h2 id="course-reward-title" className="mb-2 text-xl font-semibold text-slate-900">
          Zdobyłeś +{reward.xpGained} XP!
        </h2>

        {reward.leveledUp && (
          <p className="mb-4 rounded bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
            Awans na poziom {reward.newLevel}!
          </p>
        )}

        {reward.unlockedBadges.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">Nowe odznaki:</p>
            {reward.unlockedBadges.map((badge) => (
              <p key={badge.code} className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {badge.title} (+{badge.xpReward} XP)
              </p>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Super!
        </button>
      </div>
    </div>
  );
}
