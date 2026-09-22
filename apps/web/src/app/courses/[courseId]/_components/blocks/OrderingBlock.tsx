'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GripVertical, X } from 'lucide-react';
import type { ContentBlock, ContentReaction, ResultDetail } from '@/lib/courses-types';
import { useMascotReaction } from '../player/mascot-reaction';

// Układanie kroków w kolejności. Elementy mają id nieprzejrzyste i kolejność potasowaną przez serwer (klient nie zna poprawnej). Ścieżka
// podstawowa to przyciski "w górę / w dół" (klawiatura, czytniki ekranu, dotyk); przeciąganie myszą to udogodnienie. Po przesunięciu fokus
// zostaje na przesuniętym elemencie, a zmiana jest ogłaszana (aria-live). Odpowiedź dla serwera: { order: [id nieprzejrzyste...] }.
// Tryb wyniku (`result`): kolejność gracza z oznaczeniem trafień, poprawna kolejność i wyjaśnienie.

export interface OrderingResult {
  answer?: { order: string[] };
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  reaction?: ContentReaction;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function OrderingBlock({
  block,
  onSubmit,
  disabled,
  result,
  onContinue,
  continueLabel = 'Dalej',
}: {
  block: ContentBlock;
  onSubmit?: (answer: { order: string[] }) => void;
  disabled?: boolean;
  result?: OrderingResult;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const items = block.items ?? [];
  const mascot = useMascotReaction();
  const [order, setOrder] = useState<string[]>(result?.answer?.order ?? items.map((item) => item.id ?? item.text));
  const [announcement, setAnnouncement] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const buttons = useRef<Record<string, { up: HTMLButtonElement | null; down: HTMLButtonElement | null }>>({});
  const pendingFocus = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const readOnly = !!result;
  const byId = new Map(items.map((item) => [item.id ?? item.text, item]));
  const correctOrder = result?.detail?.correctOrder ?? [];

  // Reakcja z treści (schemaVersion 4, reactions.result) ma pierwszeństwo; starsza treść bez niej dostaje ogólne ostrzeżenie przy błędzie.
  useEffect(() => {
    if (!onContinue || !result) return;
    if (result.reaction) mascot.show(result.reaction);
    else if (result.correct === false) mascot.react('wrong');
    // Jednorazowo przy pokazaniu wyniku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fokus wraca na przesunięty element (po zmianie kolejności React przestawia węzły, więc ustawiamy go po renderze).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const pair = buttons.current[target.id];
    const preferred = target.dir === 'up' ? pair?.up : pair?.down;
    const fallback = target.dir === 'up' ? pair?.down : pair?.up;
    // Na brzegu listy przycisk kierunku jest nieaktywny: fokus przechodzi na przeciwny.
    (preferred && !preferred.disabled ? preferred : fallback)?.focus();
  }, [order]);

  function shift(id: string, by: -1 | 1) {
    const from = order.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    setOrder((current) => move(current, from, to));
    pendingFocus.current = { id, dir: by < 0 ? 'up' : 'down' };
    const text = byId.get(id)?.text ?? '';
    setAnnouncement(`${text}: pozycja ${to + 1} z ${order.length}`);
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    setOrder((current) => move(current, from, to));
    setAnnouncement(`${byId.get(dragId)?.text ?? ''}: pozycja ${to + 1} z ${order.length}`);
    setDragId(null);
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Ułóż w kolejności</p>
      <p className="mb-4 text-lg text-slate-900">{block.prompt}</p>

      <ol aria-label="Kroki do uporządkowania" className="space-y-2">
        {order.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          const inPlace = readOnly && correctOrder[index] === id;
          const wrongPlace = readOnly && correctOrder.length > 0 && correctOrder[index] !== id;
          return (
            <li
              key={id}
              draggable={!readOnly && !disabled}
              onDragStart={(event) => {
                // Firefox nie rozpoczyna przeciągania bez setData.
                event.dataTransfer?.setData('text/plain', id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                setDragId(id);
              }}
              onDragOver={(event) => {
                if (dragId) event.preventDefault();
              }}
              onDrop={() => drop(id)}
              onDragEnd={() => setDragId(null)}
              className={`flex items-center gap-2 rounded border px-3 py-2 ${
                inPlace ? 'border-green-600 bg-green-50' : wrongPlace ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'
              } ${dragId === id ? 'opacity-50' : ''}`}
            >
              {!readOnly && <GripVertical aria-hidden="true" className="h-4 w-4 shrink-0 cursor-grab text-slate-400" />}
              <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-slate-500">{index + 1}.</span>
              <span className="min-w-0 flex-1 text-slate-900">{item.text}</span>
              {readOnly && (inPlace || wrongPlace) && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                  {inPlace ? <Check aria-hidden="true" className="h-4 w-4 text-green-700" /> : <X aria-hidden="true" className="h-4 w-4 text-red-700" />}
                  {inPlace ? 'na miejscu' : 'zła pozycja'}
                </span>
              )}
              {!readOnly && (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    ref={(element) => {
                      buttons.current[id] = { ...(buttons.current[id] ?? { up: null, down: null }), up: element };
                    }}
                    onClick={() => shift(id, -1)}
                    disabled={index === 0 || disabled}
                    aria-label={`Przesuń w górę: ${item.text}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    ref={(element) => {
                      buttons.current[id] = { ...(buttons.current[id] ?? { up: null, down: null }), down: element };
                    }}
                    onClick={() => shift(id, 1)}
                    disabled={index === order.length - 1 || disabled}
                    aria-label={`Przesuń w dół: ${item.text}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {readOnly && correctOrder.length > 0 && (
        <section aria-label="Poprawna kolejność" className="mt-4 rounded bg-slate-50 p-3 ring-1 ring-slate-200">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Poprawna kolejność</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {correctOrder.map((id) => (
              <li key={id}>{byId.get(id)?.text}</li>
            ))}
          </ol>
          {result?.detail?.explanation && <p className="mt-2 text-sm text-slate-700">{result.detail.explanation}</p>}
        </section>
      )}

      {readOnly ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className={`text-sm font-medium ${result?.correct ? 'text-green-700' : 'text-slate-800'}`}>
            {result?.correct ? 'Świetnie: kolejność jest poprawna.' : 'Kolejność nie jest w pełni poprawna.'}
            {typeof result?.points === 'number' && ` Wynik: ${Math.round(result.points * 100)}%.`}
          </p>
          {onContinue && (
            <button type="button" onClick={onContinue} className="min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
              {continueLabel}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit?.({ order })}
          className="mt-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Sprawdź kolejność
        </button>
      )}
    </div>
  );
}
