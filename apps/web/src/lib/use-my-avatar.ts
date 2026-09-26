'use client';

import { useEffect, useState } from 'react';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';

// Wydzielony z Topbar.tsx (fix/dialogue-polish) - jedna logika pobierania własnego avatara, współdzielona przez
// Topbar (pasek nawigacji) i odtwarzacz kursu (CoursePlayer.tsx -> dymki gracza w DIALOGUE). Pobiera RAZ na
// `userEmail` (nie na każde wywołanie/rerender) - w odtwarzaczu wołany na poziomie CoursePlayer.tsx, NIE wewnątrz
// DialogueBlock.tsx (ten remountuje się przy każdej zmianie bloku - powtórne żądanie na każde wejście w kolejny
// blok DIALOGUE byłoby zbędne). Błąd/brak avatara = `avatarUrl: null` (inicjały jako fallback, liczone przez
// wywołującego - `initialsFromEmail`, ten sam plik `@/lib/avatar`).
export function useMyAvatar(userEmail: string | null): { avatarUrl: string | null } {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    // Nowy użytkownik nie może widzieć avatara poprzedniego do czasu odpowiedzi.
    setAvatarUrl(null);
    if (!userEmail) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/users/me/avatar');
        if (!response?.ok) {
          return;
        }
        const data = await response.json();
        if (!cancelled && typeof data?.avatarUrl === 'string') {
          setAvatarUrl(data.avatarUrl);
        }
      } catch {
        // inicjały jako fallback
      }
    })();

    function handleChanged(event: Event) {
      const next = (event as CustomEvent<string | null>).detail;
      setAvatarUrl(typeof next === 'string' ? next : null);
    }
    window.addEventListener(AVATAR_CHANGED_EVENT, handleChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(AVATAR_CHANGED_EVENT, handleChanged);
    };
  }, [userEmail]);

  return { avatarUrl };
}
