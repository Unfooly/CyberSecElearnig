'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { GamificationOverview } from '@/lib/gamification-types';
import AvatarDisplay from './AvatarDisplay';
import AvatarPickerModal from './AvatarPickerModal';

export default function UserGamificationCard({ overview }: { overview: GamificationOverview }) {
  const [avatarUrl, setAvatarUrl] = useState(overview.avatarUrl);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const percent = Math.min(100, Math.max(0, overview.currentLevelProgressPercent));

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          className="rounded-full ring-offset-2 hover:ring-2 hover:ring-slate-300"
          aria-label="Zmień avatar"
        >
          <AvatarDisplay avatarUrl={avatarUrl} size="sm" />
        </button>
        <span className="text-xs text-slate-400">Zmień avatar</span>
      </div>

      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
        Twoje osiągnięcia
      </p>

      <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-4xl" aria-hidden="true">
        🛡️
      </div>

      <p className="text-center text-lg font-bold text-slate-900">Poziom {overview.level}</p>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Postęp do następnego poziomu"
        className="my-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-center text-xs text-slate-500">
        {overview.xp} / {overview.nextLevelXp} XP
      </p>

      {overview.badges.length > 0 && (
        <div className="mt-4 flex justify-center gap-2">
          {overview.badges.slice(0, 4).map((badge) => (
            <span
              key={badge.code}
              title={badge.title}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-lg"
            >
              🏅
            </span>
          ))}
          {overview.badges.length > 4 && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
              +{overview.badges.length - 4}
            </span>
          )}
        </div>
      )}

      <Link
        href="/courses/achievements"
        className="mt-4 block text-center text-sm font-medium text-emerald-700 hover:underline"
      >
        Zobacz odznaki ({overview.badges.length})
      </Link>

      {/* Wystawianie certyfikatów nie jest jeszcze zbudowane - wyszarzony
          przycisk zamiast udawania działającej funkcji, ten sam wzorzec co
          "Wkrótce" w Topbar.tsx dla niezbudowanych ekranów. */}
      <button
        type="button"
        disabled
        title="Wkrótce"
        className="mt-4 w-full cursor-not-allowed rounded-full border border-slate-200 py-2 text-sm font-medium text-slate-300"
      >
        Wystaw certyfikat
      </button>

      {isPickerOpen && (
        <AvatarPickerModal
          currentAvatarUrl={avatarUrl}
          onClose={() => setIsPickerOpen(false)}
          onSaved={(newAvatarUrl) => {
            setAvatarUrl(newAvatarUrl);
            setIsPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
