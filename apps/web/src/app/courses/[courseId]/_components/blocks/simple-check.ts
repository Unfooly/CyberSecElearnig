'use client';

import { useCallback, useRef, useState } from 'react';
import type { CheckResponse, SimpleCheck } from '@/lib/courses-types';

// Ocena jednego kliknięcia (tryb prosty i SWIPE_SORT, D-132): POST /api/courses/:id/blocks/:blockId/check. Klient wysyła tylko swój wybór,
// werdykt, zdanie i podpowiedź (po 2 błędach) liczy serwer. Stan prób zaczyna się od postępu z /start (odświeżenie strony w trakcie bloku).

export type CheckBody = { option: number } | { card: string; verdict: 'suspicious' | 'ok' };

export function useSimpleCheck(courseId: string, blockId: string, initial?: { checks?: SimpleCheck[]; hint?: string }) {
  const [checks, setChecks] = useState<SimpleCheck[]>(initial?.checks ?? []);
  const [hint, setHint] = useState<string | undefined>(initial?.hint);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const check = useCallback(
    async (body: CheckBody): Promise<CheckResponse | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/blocks/${encodeURIComponent(blockId)}/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        // Sesja wygasła - logowanie (jak zapis bloku i podważenie w przesłuchaniu).
        if (response.status === 401) {
          window.location.assign('/login');
          return null;
        }
        const data = (await response.json().catch(() => null)) as (CheckResponse & { message?: unknown }) | null;
        if (!response.ok || !data || (data.result !== 'good' && data.result !== 'bad')) {
          // `message` z API bywa tablicą (walidator) albo angielskim tekstem (limit żądań, 403/500 Nest) - stały komunikat dla 429, polski
          // napis z API tylko przy 400/409 (nasze BadRequest: „Ta karta jest już oceniona” itd.), inaczej ogólny tekst.
          const own = (response.status === 400 || response.status === 409) && typeof data?.message === 'string' && data.message.length <= 200;
          setError(
            response.status === 429
              ? 'Za dużo kliknięć naraz. Odczekaj chwilę i spróbuj ponownie.'
              : own && typeof data?.message === 'string'
                ? data.message
                : 'Nie udało się sprawdzić odpowiedzi. Spróbuj ponownie.',
          );
          return null;
        }
        const item = 'option' in body ? body.option : body.card;
        setChecks((list) => [...list, { item, result: data.result, feedback: data.feedback }]);
        if (data.hint) setHint(data.hint);
        return data;
      } catch {
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
        return null;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [courseId, blockId],
  );

  return { checks, hint, pending, error, check };
}
