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
        const data = (await response.json().catch(() => null)) as (CheckResponse & { message?: string }) | null;
        if (!response.ok || !data || (data.result !== 'good' && data.result !== 'bad')) {
          setError(data?.message ?? 'Nie udało się sprawdzić odpowiedzi. Spróbuj ponownie.');
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
