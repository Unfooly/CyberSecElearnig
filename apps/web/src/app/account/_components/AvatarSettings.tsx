'use client';

import { useState } from 'react';
import Card, { CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { AVATAR_PRESETS } from '@/lib/gamification-types';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

/**
 * Wybór avatara w ustawieniach konta. Wcześniej ta sama siatka presetów żyła w
 * modalu otwieranym z karty „Twoje osiągnięcia” (`AvatarPickerModal`); na ekranie
 * ustawień modal byłby zbędnym krokiem, więc wybór jest sekcją strony (D-066).
 * Zapis idzie niezmienioną ścieżką: PATCH /api/users/me/avatar (trasa BFF).
 */
export default function AvatarSettings({ initialAvatarUrl }: { initialAvatarUrl: string | null }) {
  // Zapisany stan (do porównania) i bieżący wybór - "Zapisz" ma sens tylko, gdy się różnią.
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(initialAvatarUrl);
  const [selected, setSelected] = useState<string | null>(initialAvatarUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  async function handleSave() {
    if (!selected) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setIsSaved(false);
    try {
      const response = await fetch('/api/users/me/avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: selected }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.message ?? 'Nie udało się zapisać avatara.');
        return;
      }

      // Topbar (osobny komponent, na każdej stronie) nasłuchuje tego zdarzenia
      // i od razu podmienia inicjały na nowy avatar - bez przeładowania strony.
      window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: data.avatarUrl as string }));
      setSavedAvatarUrl(data.avatarUrl as string);
      setSelected(data.avatarUrl as string);
      setIsSaved(true);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Avatar" id="avatar-settings-title" />
      <div className="p-5">
        <p className="mb-4 text-sm text-muted">
          Avatar widzą inni pracownicy Twojej organizacji w rankingu i przy Twoich wynikach.
        </p>

        <div
          role="group"
          aria-labelledby="avatar-settings-title"
          className="mb-5 grid grid-cols-4 gap-3 sm:grid-cols-8"
        >
          {Object.entries(AVATAR_PRESETS).map(([slug, Icon]) => (
            <button
              key={slug}
              type="button"
              onClick={() => {
                setSelected(slug);
                setIsSaved(false);
              }}
              aria-pressed={selected === slug}
              aria-label={slug}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
                selected === slug
                  ? 'bg-accent text-white ring-2 ring-accent ring-offset-2'
                  : 'bg-accent-soft text-accent-ink hover:bg-accent-soft/60'
              }`}
            >
              <Icon size={24} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={isSubmitting || !selected || selected === savedAvatarUrl}>
            {isSubmitting ? 'Zapisywanie...' : 'Zapisz'}
          </Button>
          {/* Komunikat po zapisie: bez niego jedyną informacją zwrotną jest zmiana avatara w pasku. */}
          {isSaved && (
            <p role="status" className="text-sm font-semibold text-muted">
              Avatar zapisany.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
