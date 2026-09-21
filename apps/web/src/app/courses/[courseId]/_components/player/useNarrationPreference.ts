'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Ustawienie "Lektor wył./wł." zapisywane NA KONCIE od razu przy każdej zmianie (PATCH /users/me/preferences przez BFF), nie tylko w
// localStorage: po odświeżeniu i na innym urządzeniu wartość pochodzi z serwera (page.tsx czyta ją server-side). Zmiana jest
// optymistyczna, a przy błędzie wraca do poprzedniej wartości z komunikatem.
export function useNarrationPreference(initial: boolean) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Numer ostatniego żądania: odpowiedź starszego żądania nie może nadpisać nowszej zmiany (szybkie kliknięcia).
  const latest = useRef(0);
  const current = useRef(initial);

  const set = useCallback(
    async (next: boolean) => {
      const previous = current.current;
      const requestId = ++latest.current;
      current.current = next;
      setEnabled(next);
      setError(null);
      setPending(true);
      try {
        const response = await fetch('/api/users/me/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ narrationEnabled: next }),
        });
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        if (!response.ok) throw new Error(`status ${response.status}`);
      } catch {
        if (requestId === latest.current) {
          current.current = previous;
          setEnabled(previous);
          setError('Nie udało się zapisać ustawienia lektora. Spróbuj ponownie.');
        }
      } finally {
        if (requestId === latest.current) setPending(false);
      }
    },
    [router],
  );

  const toggle = useCallback(() => set(!current.current), [set]);
  return { enabled, pending, error, toggle };
}
