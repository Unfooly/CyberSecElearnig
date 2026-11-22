'use client';

import { useEffect, useId } from 'react';
import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';
import { OPTION, OptionMark, optionTone, useRevealOnCheck } from './simple-option';
import MonitorStage from '../player/MonitorStage';

// Wybór w trybie prostym (QUIZ, D-132): duże przyciski odpowiedzi; każde kliknięcie sprawdza serwer (/check) - od razu „Dobrze”/„Nie tym
// razem” i zdanie z treści. Błędna odpowiedź zostaje oznaczona i wyłączona, można próbować dalej; po 2 błędach - podpowiedź. „Dalej” w pasku
// po trafieniu (zapis z indeksem trafionej odpowiedzi; wynik serwer liczy z PIERWSZEJ próby). Bez wyniku w bloku.
// Wygląd (szablon modułu, D-164): pytanie na ekranie wspólnego monitora (MonitorStage), „Pytanie N z M”, odpowiedzi A/B/C.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export default function SimpleChoiceBlock({
  block,
  courseId,
  progress,
  onSubmit,
  onReady,
  onProgress,
  disabled = false,
  questionLabel,
  contentBase = '',
}: {
  /** „Pytanie 2 z 5” - numer wśród pytań quizu modułu (CoursePlayer). */
  questionLabel?: string;
  /** Baza adresów zasobów - ilustracja obok pytania (D-200). */
  contentBase?: string;
  block: ContentBlock;
  courseId: string;
  progress?: ClientProgressBlock;
  onSubmit: (answer: number) => void;
  onReady: (submit: (() => void) | null) => void;
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
  disabled?: boolean;
}) {
  const promptId = useId();
  const options = block.options ?? [];
  const { checks, hint, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  const hit = checks.find((entry) => entry.result === 'good');
  const hitIndex = typeof hit?.item === 'number' ? hit.item : null;
  const last = checks[checks.length - 1];
  const revealRef = useRevealOnCheck(checks.length);

  useEffect(() => {
    onReady(hitIndex !== null ? () => onSubmit(hitIndex) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitIndex]);

  // Próby do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (checks.length > 0) onProgress?.({ checks, ...(hint ? { hint } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, hint]);

  return (
    <MonitorStage label="Pytanie quizu" illustration={block.illustration} contentBase={contentBase}>
      <div data-testid="simple-choice" className="flex flex-col gap-3">
        {/* Napis interfejsu (polski) w obszarze z `lang` języka treści - lang="pl" (WCAG 3.1.2, jak „Blok X z Y” w PlayerStage). */}
        {questionLabel && (
          <p lang="pl" className="text-xs font-bold uppercase tracking-[0.08em] text-accent-ink">
            {questionLabel}
          </p>
        )}
        <p id={promptId} data-monitor-prompt className="text-xl font-bold leading-snug tracking-[-0.01em] text-ink">
          {block.prompt}
        </p>
        <div role="group" aria-labelledby={promptId} className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const tried = checks.find((entry) => entry.item === index);
            const state = tried?.result ?? null;
            // Sprawdzona odpowiedź i czas sprawdzania: aria-disabled (nie `disabled`) - fokus zostaje na klikniętym przycisku, klawiatura i
            // czytnik nie wracają na początek strony po każdym kliknięciu. Klik w takim stanie nic nie robi.
            const locked = pending || hitIndex !== null || state !== null;
            return (
              <button
                key={index}
                type="button"
                data-testid="simple-option"
                data-result={state ?? undefined}
                disabled={disabled}
                aria-disabled={locked || undefined}
                onClick={() => {
                  if (!locked) void check({ option: index });
                }}
                className={`${OPTION} ${FOCUS_RING} ${optionTone(state, locked)} disabled:cursor-default ${locked ? 'cursor-default' : ''}`}
              >
                <OptionMark index={index} state={state} />
                <span>{option.text}</span>
                {state && <span className="sr-only">{state === 'good' ? ' - dobra odpowiedź' : ' - zła odpowiedź'}</span>}
              </button>
            );
          })}
        </div>
        <div ref={revealRef}>
          <SimpleFeedback variant="plain" result={last?.result ?? null} text={last?.feedback} />
        </div>
        <SimpleHint text={hitIndex === null ? hint : undefined} />
        <SimpleError text={error} />
      </div>
    </MonitorStage>
  );
}
