'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card, { CardHeader } from '@/components/ui/Card';

/**
 * Dostępność w ustawieniach konta (D-124): „Bez limitów czasu” (WCAG 2.2.1). Zapis od razu przy zmianie (PATCH /api/users/me/preferences),
 * optymistycznie - przy błędzie przełącznik wraca z komunikatem. Serwer stosuje ustawienie w ocenie (rozmowa na żywo bez ciszy po limicie),
 * a odtwarzacz przy włączonym ustawieniu prowadzi rozmowę bez limitu (bez przełącznika na ekranie przed połączeniem).
 */
export default function AccessibilitySettings({ initialNoTimeLimits }: { initialNoTimeLimits: boolean }) {
  const router = useRouter();
  const [noTimeLimits, setNoTimeLimits] = useState(initialNoTimeLimits);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // Odpowiedź starszego zapisu nie może nadpisać nowszej zmiany (szybkie kliknięcia).
  const latest = useRef(0);

  async function change(next: boolean) {
    const previous = noTimeLimits;
    const requestId = ++latest.current;
    setNoTimeLimits(next);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/users/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noTimeLimits: next }),
      });
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (!response.ok) throw new Error(`status ${response.status}`);
      if (requestId === latest.current) setMessage({ tone: 'ok', text: 'Zapisano.' });
    } catch {
      if (requestId === latest.current) {
        setNoTimeLimits(previous);
        setMessage({ tone: 'error', text: 'Nie udało się zapisać ustawienia. Spróbuj ponownie.' });
      }
    } finally {
      if (requestId === latest.current) setPending(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader title="Dostępność" id="accessibility-settings-title" />
      <div className="px-5 py-4">
        <label className="flex min-h-[44px] cursor-pointer items-start justify-between gap-4">
          <span>
            <span className="block font-semibold text-ink">Bez limitów czasu</span>
            <span id="no-time-limits-hint" className="block text-sm text-slate-600">
              W szkoleniach z odliczaniem czasu (np. rozmowa na żywo) nie będzie limitu na odpowiedź. Możesz go też wyłączyć przed każdą taką
              rozmową.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            data-testid="no-time-limits"
            aria-describedby="no-time-limits-hint"
            checked={noTimeLimits}
            disabled={pending}
            onChange={(event) => change(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </label>
        <p role="status" className={`min-h-[1.25rem] text-sm ${message?.tone === 'error' ? 'text-danger' : 'text-slate-600'}`}>
          {message?.text ?? ''}
        </p>
      </div>
    </Card>
  );
}
