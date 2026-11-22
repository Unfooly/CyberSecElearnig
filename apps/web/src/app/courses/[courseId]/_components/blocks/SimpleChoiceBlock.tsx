'use client';

import { useEffect, useId, useState } from 'react';
import type { ClientProgressBlock, ContentBlock } from '@/lib/courses-types';
import { useSimpleCheck } from './simple-check';
import { SimpleError, SimpleFeedback } from './SimpleFeedback';
import { OPTION, OptionFeedback, OptionMark, decidedMarks, optionTone, useRevealOnCheck } from './simple-option';
import MonitorStage from '../player/MonitorStage';

// Wybór w trybie prostym (QUIZ, D-132; D-204 - decyzja właściciela 2026-11-22: „każda odpowiedź powinna być zaznaczona i wynik sprawdzany
// dopiero jak klikamy Sprawdź”, po błędzie „pokazać poprawną i iść dalej”): klik zaznacza odpowiedź (można zmienić), „Sprawdź” wysyła ją
// do serwera (/check) - JEDNA próba rozstrzyga pytanie. Po niej: zaznaczona zielona/czerwona, poprawna (gdy nie ta) zielona, każda ze
// zdaniem z treści; „Dalej” w pasku od razu. Bez prób do skutku i podpowiedzi. Wynik bloku liczy serwer z tej próby.
// Wygląd (szablon modułu, D-164): pytanie na ekranie wspólnego monitora (MonitorStage), „Pytanie N z M”, odpowiedzi A/B/C - natywny
// przycisk radiowy schowany (sr-only) za literą.

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
  const groupName = useId();
  const options = block.options ?? [];
  const { checks, pending, error, check } = useSimpleCheck(courseId, block.id ?? '', progress);
  // Rozstrzyga pierwsza próba (wpisy sprzed D-204 mogą mieć ich więcej - serwer pokazuje tylko pierwszą).
  const decided = checks[0];
  const decidedIndex = typeof decided?.item === 'number' ? decided.item : null;
  const marks = decidedMarks(decided);
  const revealRef = useRevealOnCheck(checks.length);
  const [selected, setSelected] = useState<number | null>(decidedIndex);
  const locked = disabled || pending || decided !== undefined;

  useEffect(() => {
    onReady(decidedIndex !== null ? () => onSubmit(decidedIndex) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decidedIndex]);

  // Próba do podglądu „Wstecz” w tej samej sesji.
  useEffect(() => {
    if (checks.length > 0) onProgress?.({ checks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks]);

  return (
    <MonitorStage label="Pytanie quizu" illustration={block.illustration} contentBase={contentBase}>
      <div data-testid="simple-choice" className="flex flex-col gap-3">
        {/* Napis interfejsu (polski) w obszarze z `lang` języka treści - lang="pl" (WCAG 3.1.2, jak „Blok X z Y” w PlayerStage). */}
        {questionLabel && (
          <p lang="pl" className="text-xs font-bold uppercase tracking-[0.08em] text-accent-ink">
            {questionLabel}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <p id={promptId} data-monitor-prompt className="text-xl font-bold leading-snug tracking-[-0.01em] text-ink">
            {block.prompt}
          </p>
          <p id={`${promptId}-how`} lang="pl" className="text-base text-muted">
            Zaznacz jedną odpowiedź i kliknij „Sprawdź”.
          </p>
        </div>
        <div role="radiogroup" aria-labelledby={promptId} aria-describedby={`${promptId}-how`} className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const mark = marks.get(index);
            const checked = selected === index;
            return (
              <label
                key={index}
                data-testid="simple-option"
                data-result={mark?.result}
                data-picked={mark ? String(mark.picked !== false) : undefined}
                className={`${OPTION} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${optionTone(
                  mark?.result ?? null,
                  locked,
                  checked,
                )} ${locked ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  checked={checked}
                  // aria-disabled zamiast `disabled` w trakcie sprawdzania i po rozstrzygnięciu - fokus zostaje na odpowiedzi.
                  disabled={disabled}
                  aria-disabled={locked || undefined}
                  onChange={() => {
                    if (!locked) setSelected(index);
                  }}
                  className="sr-only"
                />
                <OptionMark index={index} state={mark?.result ?? null} selected={checked} />
                <span className="flex min-w-0 flex-col gap-1">
                  <span>{option.text}</span>
                  {mark && <OptionFeedback mark={mark} testId="simple-option-feedback" />}
                </span>
              </label>
            );
          })}
        </div>
        <div>
          {/* Po rozstrzygnięciu przycisk zostaje (aria-disabled, „Sprawdzone”) - fokus klawiatury i czytnika nie ucieka na początek strony. */}
          <button
            type="button"
            data-testid="simple-check"
            disabled={disabled || (decided === undefined && (pending || selected === null))}
            aria-disabled={decided !== undefined || undefined}
            onClick={() => {
              if (decided === undefined && selected !== null) void check({ option: selected });
            }}
            className={`min-h-[44px] rounded-[10px] bg-ink px-5 text-base font-bold text-white hover:bg-slate-800 disabled:cursor-default disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 ${FOCUS_RING}`}
          >
            {decided === undefined ? 'Sprawdź' : 'Sprawdzone'}
          </button>
        </div>
        <div ref={revealRef} lang="pl">
          <SimpleFeedback
            variant="plain"
            result={decided?.result ?? null}
            text={decided?.result === 'good' ? 'To poprawna odpowiedź.' : 'Poprawną odpowiedź oznaczyliśmy znakiem ✓.'}
          />
        </div>
        <SimpleError text={error} />
      </div>
    </MonitorStage>
  );
}
