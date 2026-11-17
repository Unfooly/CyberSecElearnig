'use client';

import { useEffect, useId } from 'react';
import { Check, X } from 'lucide-react';
import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback, SimpleHint } from './SimpleFeedback';
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
}: {
  /** „Pytanie 2 z 5” - numer wśród pytań quizu modułu (CoursePlayer). */
  questionLabel?: string;
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
    <MonitorStage label="Pytanie quizu">
      <div data-testid="simple-choice" className="flex flex-col gap-3">
        {questionLabel && <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-ink">{questionLabel}</p>}
        <p id={promptId} className="text-xl font-bold leading-snug tracking-[-0.01em] text-ink">
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
        <SimpleFeedback variant="plain" result={last?.result ?? null} text={last?.feedback} />
        <SimpleHint text={hitIndex === null ? hint : undefined} />
        <SimpleError text={error} />
      </div>
    </MonitorStage>
  );
}

// Odpowiedź jak na makiecie (D-164): ≥ 44 px, litera w kółku; po ocenie kolor (zielony/czerwony) i ✓/✕ zamiast litery - nie sam kolor.
export const OPTION =
  'flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2 text-left text-base font-semibold leading-snug';

export function optionTone(state: 'good' | 'bad' | null, locked: boolean, selected = false): string {
  if (state === 'good') return 'border-2 border-success bg-success-soft text-[#0F5A3A]';
  if (state === 'bad') return 'border-2 border-danger bg-danger-soft text-[#8A251B]';
  if (selected) return 'border-2 border-accent bg-accent-soft text-ink';
  return `border border-border bg-white text-ink ${locked ? '' : 'hover:border-accent hover:bg-paper'}`;
}

export function OptionMark({ index, state, selected = false }: { index: number; state: 'good' | 'bad' | null; selected?: boolean }) {
  const tone =
    state === 'good' ? 'bg-success text-white' : state === 'bad' ? 'bg-danger text-white' : selected ? 'bg-accent text-white' : 'bg-[#F0EFEC] text-[#4A4A47]';
  return (
    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${tone}`}>
      {state === 'good' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === 'bad' ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : String.fromCharCode(65 + index)}
    </span>
  );
}
