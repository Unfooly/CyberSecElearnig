'use client';

import { CircleAlert, CircleCheck, Lightbulb } from 'lucide-react';

// Tryb prosty (D-132): ocena kliknięcia od razu - „Dobrze”/„Nie tym razem” i jedno zdanie z treści (z odpowiedzi /check). Region `status`:
// czytnik ekranu ogłasza werdykt bez przenoszenia fokusu. Podpowiedź po 2 błędach zostaje widoczna do końca bloku (nie znika po kilku
// sekundach jak dymek podpowiedzi powłoki).

export function SimpleFeedback({ result, text, about }: { result: 'good' | 'bad' | null; text?: string; about?: string }) {
  return (
    <div role="status" aria-live="polite" data-testid="simple-feedback" data-result={result ?? undefined} className="min-h-[3.5rem]">
      {result && (
        <p
          className={`flex items-start gap-2 rounded-card border px-4 py-3 text-base ${
            result === 'good' ? 'border-success/40 bg-success/10 text-ink' : 'border-danger/40 bg-danger/10 text-ink'
          }`}
        >
          {result === 'good' ? (
            <CircleCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          ) : (
            <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          )}
          <span>
            {/* Kontekst oceny (SWIPE_SORT): zdanie dotyczy poprzedniej karty, a pod spodem jest już następna. */}
            {about && <span className="block text-muted">{about}</span>}
            <span className="font-bold">{result === 'good' ? 'Dobrze! ' : 'Nie tym razem. '}</span>
            {text}
          </span>
        </p>
      )}
    </div>
  );
}

export function SimpleHint({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p data-testid="simple-hint" className="flex items-start gap-2 rounded-card border border-accent/40 bg-accent-soft px-4 py-3 text-base text-ink">
      <Lightbulb aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <span>
        <span className="font-bold">Podpowiedź: </span>
        {text}
      </span>
    </p>
  );
}

export function SimpleError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-base text-danger">
      {text}
    </p>
  );
}
