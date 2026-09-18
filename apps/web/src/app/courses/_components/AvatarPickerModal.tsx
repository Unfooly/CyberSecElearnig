'use client';

import { useEffect, useState } from 'react';
import { AVATAR_PRESETS } from '@/lib/gamification-types';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

export default function AvatarPickerModal({
  currentAvatarUrl,
  onClose,
  onSaved,
}: {
  currentAvatarUrl: string | null;
  onClose: () => void;
  onSaved: (avatarUrl: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentAvatarUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a11y: Escape zamyka modal, zgodnie z oczekiwanym zachowaniem dialogu
  // (WAI-ARIA) - jedyny sposób zamknięcia bez myszki, dopóki nie ma pełnego
  // focus trapu w tym repo.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleSave() {
    if (!selected) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
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
      // i od razu podmienia inicjały na nowy avatar.
      window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: data.avatarUrl as string }));
      onSaved(data.avatarUrl as string);
    } catch {
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 id="avatar-picker-title" className="mb-4 text-lg font-bold tracking-[-0.01em]">
          Wybierz avatar
        </h2>

        <div className="mb-4 grid grid-cols-4 gap-3">
          {Object.entries(AVATAR_PRESETS).map(([slug, Icon]) => (
            <button
              key={slug}
              type="button"
              onClick={() => setSelected(slug)}
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
          <p role="alert" className="mb-4 rounded-btn bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-btn px-4 text-sm font-bold text-accent-ink hover:bg-accent-soft"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || !selected}
            className="h-10 rounded-btn bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {isSubmitting ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
