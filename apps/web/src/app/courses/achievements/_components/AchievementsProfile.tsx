'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, GripVertical } from 'lucide-react';
import { MAX_PINNED, PIN_LIMIT_MESSAGE, achievementImage, type Badge, type PinnedAchievement } from '@/lib/gamification-types';
import PinnedBadges from '../../_components/PinnedBadges';
import AchievementGrid from './AchievementGrid';

// Profil osiągnięć (D-111, D-112): nagłówek z imieniem i przypiętymi miniaturami, sekcja „Przypięte” (maks. 3, kolejność
// przeciąganiem albo strzałkami, odpinanie) i karty z obrotem (przypinanie z rewersu zdobytej karty). Zapis przez BFF
// (/api/gamification/pinned, cała lista naraz); serwer sprawdza, czy osiągnięcia są zdobyte. Zmiana od razu w UI, przy błędzie
// wraca poprzedni stan i komunikat.

function initialPinned(badges: Badge[]): string[] {
  return badges
    .filter((badge) => badge.isUnlocked && badge.title && badge.pinned !== null)
    .sort((a, b) => (a.pinned ?? 0) - (b.pinned ?? 0))
    .map((badge) => badge.code);
}

export default function AchievementsProfile({ badges, displayName }: { badges: Badge[]; displayName: string | null }) {
  const [pinned, setPinned] = useState<string[]>(() => initialPinned(badges));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const [announcement, setAnnouncement] = useState('');
  const byCode = new Map(badges.map((badge) => [badge.code, badge]));
  // `pinned` zawiera wyłącznie kody zdobytych osiągnięć z tej listy (initialPinned, togglePin) - ta sama tablica i te same
  // indeksy dla przesuwania, przeciągania i wyświetlania.
  const pinnedBadges: PinnedAchievement[] = pinned.map((code) => {
    const badge = byCode.get(code)!;
    return { code, title: badge.title ?? '', icon: badge.icon, rank: badge.rank };
  });
  const unlockedCount = badges.filter((badge) => badge.isUnlocked).length;

  async function save(next: string[]) {
    const previous = pinned;
    setPinned(next);
    setMessage(null);
    setSaving(true);
    try {
      const response = await fetch('/api/gamification/pinned', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const text = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
        setPinned(previous);
        setAnnouncement('');
        setMessage(typeof text === 'string' && text.length > 0 ? text : 'Nie udało się zapisać przypiętych odznak.');
      }
    } catch {
      setPinned(previous);
      setAnnouncement('');
      setMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie później.');
    } finally {
      setSaving(false);
    }
  }

  function togglePin(code: string) {
    if (saving || !byCode.get(code)?.isUnlocked) return;
    if (pinned.includes(code)) {
      void save(pinned.filter((pinnedCode) => pinnedCode !== code));
      return;
    }
    if (pinned.length >= MAX_PINNED) {
      setMessage(PIN_LIMIT_MESSAGE);
      return;
    }
    void save([...pinned, code]);
  }

  function move(from: number, to: number, focusSelector?: string) {
    if (saving || to < 0 || to >= pinned.length || from === to) return;
    const next = [...pinned];
    const [code] = next.splice(from, 1);
    next.splice(to, 0, code);
    setAnnouncement(`${byCode.get(code)?.title ?? ''}: pozycja ${to + 1} z ${next.length}.`);
    void save(next);
    // Strzałka na skraju listy staje się nieaktywna - fokus idzie na przeciwną strzałkę tej samej pozycji (nie spada na body).
    if (focusSelector) {
      requestAnimationFrame(() => {
        const item = document.querySelector<HTMLElement>(`[data-pinned-code="${code}"]`);
        const target = item?.querySelector<HTMLButtonElement>(focusSelector);
        (target && !target.disabled ? target : item?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
      });
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-baseline gap-3 text-2xl font-semibold text-slate-900">
            Osiągnięcia
            <span className="text-base font-bold text-muted" data-testid="achievements-counter">
              {unlockedCount} / {badges.length}
            </span>
          </h1>
          {displayName && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink" data-testid="profile-name">
              <span>{displayName}</span>
              <PinnedBadges pinned={pinnedBadges} />
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="pinned-heading" className="mb-6 max-w-[780px]">
        <h2 id="pinned-heading" className="mb-2 text-base font-bold text-ink">
          Przypięte <span className="text-sm font-semibold text-muted">({pinned.length} / {MAX_PINNED})</span>
        </h2>
        {pinnedBadges.length === 0 ? (
          <p className="text-sm text-muted">
            Odwróć zdobytą kartę i wybierz „Przypnij do profilu”. Przypięte pokazujesz przy swoim imieniu (na profilu i w rankingu
            organizacji, jeśli jest włączony).
          </p>
        ) : (
          <ol className="flex flex-wrap gap-2" data-testid="pinned-list">
            {pinnedBadges.map((badge, index) => {
              const image = achievementImage(badge.icon);
              return (
                <li
                  key={badge.code}
                  draggable={!saving}
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    if (dragIndex !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null) move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  data-testid="pinned-item"
                  data-pinned-code={badge.code}
                  className={`flex items-center gap-2 rounded-card border border-border bg-surface py-1.5 pl-1 pr-2 shadow-card ${dragIndex === index ? 'opacity-60' : ''}`}
                >
                  <GripVertical aria-hidden="true" className="h-4 w-4 shrink-0 cursor-grab text-muted" />
                  {image && (
                    // eslint-disable-next-line @next/next/no-img-element -- statyczny SVG z public/achievements; SVG wyłącznie przez <img> (D-051)
                    <img src={image} alt="" width={36} height={36} className="h-9 w-9" />
                  )}
                  <span className="text-sm font-semibold">
                    <span className="sr-only">{index + 1}. </span>
                    {badge.title}
                  </span>
                  <span className="ml-1 flex items-center">
                    <button
                      type="button"
                      aria-label={`Przesuń ${badge.title} w lewo`}
                      // W czasie zapisu tylko aria-disabled (strażnik w move): natywne `disabled` zdejmowało fokus na body.
                      disabled={index === 0}
                      aria-disabled={saving || undefined}
                      data-move="left"
                      onClick={() => move(index, index - 1, '[data-move="left"]')}
                      className="flex h-11 w-11 items-center justify-center rounded-btn text-muted hover:bg-paper disabled:opacity-30 aria-disabled:opacity-50"
                    >
                      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Przesuń ${badge.title} w prawo`}
                      disabled={index === pinnedBadges.length - 1}
                      aria-disabled={saving || undefined}
                      data-move="right"
                      onClick={() => move(index, index + 1, '[data-move="right"]')}
                      className="flex h-11 w-11 items-center justify-center rounded-btn text-muted hover:bg-paper disabled:opacity-30 aria-disabled:opacity-50"
                    >
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Odepnij ${badge.title}`}
                      aria-disabled={saving || undefined}
                      onClick={() => togglePin(badge.code)}
                      className="min-h-[44px] rounded-btn px-2 text-sm font-semibold text-accent-ink hover:bg-paper aria-disabled:opacity-50"
                    >
                      Odepnij
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p role="status" className="sr-only" data-testid="pin-announcement">
          {announcement}
        </p>
        {message && (
          <p role="alert" className="mt-3 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger" data-testid="pin-message">
            {message}
          </p>
        )}
      </section>

      <AchievementGrid badges={badges} pinnedCodes={pinned} onTogglePin={togglePin} />
    </>
  );
}
