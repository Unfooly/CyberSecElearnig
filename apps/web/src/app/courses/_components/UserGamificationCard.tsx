'use client';

import Link from 'next/link';
import { Award } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';
import { achievementImage, type GamificationOverview } from '@/lib/gamification-types';
import AvatarDisplay from './AvatarDisplay';

/** 1 osiągnięcie, 2-4 osiągnięcia (bez 12-14), reszta osiągnięć. */
function achievementsWord(count: number): string {
  if (count === 1) return 'osiągnięcie';
  const lastTwo = count % 100;
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'osiągnięcia' : 'osiągnięć';
}

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function UserGamificationCard({ overview }: { overview: GamificationOverview }) {
  const percent = Math.min(100, Math.max(0, overview.currentLevelProgressPercent));

  return (
    <Card className="flex flex-col items-center gap-3 p-[22px] text-center">
      {/* Avatar tylko do oglądania - zmienia się go w ustawieniach konta (/account, D-066). */}
      <AvatarDisplay avatarUrl={overview.avatarUrl} size="sm" />

      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Twoje osiągnięcia</p>

      <div className="relative h-[104px] w-[104px]">
        <svg viewBox="0 0 104 104" width="104" height="104" aria-hidden="true">
          <circle cx="52" cy="52" r={RING_RADIUS} fill="none" stroke="#EDEDEA" strokeWidth="8" />
          <circle
            cx="52"
            cy="52"
            r={RING_RADIUS}
            fill="none"
            stroke="#6C5CE7"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
            transform="rotate(-90 52 52)"
          />
        </svg>
        <p className="absolute inset-0 flex flex-col items-center justify-center text-[22px] font-extrabold leading-none tracking-[-0.02em]">
          {overview.level}
          <small className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Poziom</small>
        </p>
      </div>

      <p className="sr-only">Poziom {overview.level}</p>

      <div className="w-full">
        <ProgressBar value={percent} label="Postęp do następnego poziomu" />
        <div className="mt-1.5 flex justify-between text-xs font-semibold text-muted">
          <span>
            {overview.xp} / {overview.nextLevelXp} XP
          </span>
          <span>
            {overview.badges.length} {achievementsWord(overview.badges.length)}
          </span>
        </div>
      </div>

      {overview.badges.length > 0 && (
        <div className="flex justify-center gap-2">
          {overview.badges.slice(0, 4).map((badge) => {
            const image = achievementImage(badge.icon);
            return (
              <span key={badge.code} title={badge.title} className="flex h-9 w-9 items-center justify-center rounded-full bg-warning-soft text-warning">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- statyczny SVG z public/achievements; SVG wyłącznie przez <img> (D-051)
                  <img src={image} alt={badge.title} className="h-9 w-9" />
                ) : (
                  <Award size={18} strokeWidth={2} aria-hidden="true" />
                )}
              </span>
            );
          })}
          {overview.badges.length > 4 && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-paper text-xs font-bold text-muted">
              +{overview.badges.length - 4}
            </span>
          )}
        </div>
      )}

      <Link href="/courses/achievements" className="font-semibold text-accent-ink hover:underline">
        Zobacz osiągnięcia ({overview.badges.length})
      </Link>

      {/* Wystawianie certyfikatów nie jest jeszcze zbudowane - wyszarzony
          przycisk zamiast udawania działającej funkcji, ten sam wzorzec co
          "Wkrótce" w Topbar.tsx dla niezbudowanych ekranów. */}
      <Button variant="secondary" disabled title="Wkrótce" className="w-full">
        Wystaw certyfikat
      </Button>
    </Card>
  );
}
