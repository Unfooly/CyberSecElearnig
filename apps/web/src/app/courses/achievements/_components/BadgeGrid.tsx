import { formatDateLong as formatDate } from '@/lib/datetime';
import type { Badge } from '@/lib/gamification-types';

export default function BadgeGrid({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) {
    return <p className="text-sm text-slate-500">Brak odznak do wyświetlenia.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {badges.map((badge) => (
        <div
          key={badge.code}
          className={`rounded-lg p-4 shadow-sm ${
            badge.isUnlocked ? 'bg-white' : 'bg-slate-50 grayscale'
          }`}
          data-unlocked={badge.isUnlocked}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className={`font-semibold ${badge.isUnlocked ? 'text-slate-900' : 'text-slate-500'}`}>
              {badge.title}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                badge.isUnlocked ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'
              }`}
            >
              +{badge.xpReward} XP
            </span>
          </div>
          <p className="text-sm text-slate-500">{badge.description}</p>
          {badge.isUnlocked && badge.unlockedAt ? (
            <p className="mt-3 text-xs text-slate-400">Odblokowano {formatDate(badge.unlockedAt)}</p>
          ) : (
            <p className="mt-3 text-xs font-medium text-slate-400">Zablokowane</p>
          )}
        </div>
      ))}
    </div>
  );
}
