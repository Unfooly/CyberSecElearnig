'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, Info, Paperclip, X } from 'lucide-react';
import type { ContentBlock, ContentReaction, EmailCriterion, ResultDetail } from '@/lib/courses-types';
import { useMascotReaction } from '../player/mascot-reaction';

// Analiza maila: makieta klienta pocztowego (nadawca z nazwą i adresem, opcjonalny adresat "Do:", data, temat, treść, załącznik,
// linki). Kryteria zaznacza się PRZEDE WSZYSTKIM KLIKNIĘCIEM FRAGMENTU maila (nadawca, temat, link, załącznik, fragment tekstu); lista
// kryteriów pod mailem to ta sama zaznaczona lista (checkbox per kryterium), ale podczas odpowiadania jest domyślnie ZWINIĘTA za
// przyciskiem "Lista elementów (dla klawiatury)" - nie ma pokazywać z góry checklisty tego, czego szukać. Rozwinięta to ścieżka dla
// klawiatury/czytników oraz dla kryteriów bez fragmentu w mailu. W widoku wyniku (readOnly) lista jest od razu widoczna.
// Link w treści NIGDY nie nawiguje (to <button>): po najechaniu, fokusie i kliknięciu jego prawdziwy adres pokazuje pasek statusu u dołu
// makiety, jak w przeglądarce. Załącznik jest klikalny tylko jako zaznaczenie: nie ma adresu pliku, więc nic się nie pobiera.
// Odpowiedź dla serwera: { selected: [id kryterium (nieprzejrzyste)...] }. Tryb wyniku (`result`): to samo, tylko do odczytu, z oceną.

export interface EmailResult {
  answer?: { selected: string[] };
  detail?: ResultDetail;
  correct?: boolean;
  points?: number;
  reaction?: ContentReaction;
}

type Verdict = 'hit' | 'false-alarm' | 'missed' | 'neutral';

interface Segment {
  text: string;
  criterionId?: string;
  link?: { id: string; url: string };
}

/** Dzieli treść na zwykły tekst, cytaty kryteriów (pierwsze wystąpienie) i linki (tekst linku w treści); zachodzące fragmenty pomijane. */
export function bodySegments(body: string, criteria: EmailCriterion[], links: { id: string; text: string; url: string }[]): { segments: Segment[]; loose: typeof links } {
  const ranges: { start: number; end: number; criterionId?: string; link?: { id: string; url: string } }[] = [];
  const loose: typeof links = [];
  // Pierwsze WOLNE wystąpienie tekstu (nie zachodzące na już zajęty zakres): dwa linki z tym samym napisem (typowy phishing) dostają
  // kolejne wystąpienia, a link bez wolnego miejsca ląduje pod treścią, więc jego prawdziwy adres nigdy nie znika z makiety.
  const findFree = (needle: string): number => {
    if (!needle) return -1;
    let from = 0;
    for (;;) {
      const at = body.indexOf(needle, from);
      if (at < 0) return -1;
      const end = at + needle.length;
      if (!ranges.some((range) => at < range.end && end > range.start)) return at;
      from = at + 1;
    }
  };
  // Linki mają pierwszeństwo przed cytatami: adres linku musi być widoczny.
  for (const link of links) {
    const start = findFree(link.text);
    const criterion = criteria.find((c) => c.target?.kind === 'link' && c.target.linkId === link.id);
    if (start >= 0) ranges.push({ start, end: start + link.text.length, link: { id: link.id, url: link.url }, criterionId: criterion?.id });
    else loose.push(link);
  }
  for (const criterion of criteria) {
    if (criterion.target?.kind !== 'text' || !criterion.target.quote) continue;
    const start = findFree(criterion.target.quote);
    if (start >= 0) ranges.push({ start, end: start + criterion.target.quote.length, criterionId: criterion.id });
  }
  ranges.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: body.slice(cursor, range.start) });
    segments.push({ text: body.slice(range.start, range.end), criterionId: range.criterionId, link: range.link });
    cursor = range.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor) });
  return { segments, loose };
}

const VERDICT_LABEL: Record<Verdict, string> = {
  hit: 'trafione',
  'false-alarm': 'fałszywy alarm',
  missed: 'przeoczone',
  neutral: '',
};

const VERDICT_CLASS: Record<Verdict, string> = {
  hit: 'bg-green-100 ring-2 ring-green-600',
  'false-alarm': 'bg-red-100 ring-2 ring-red-600',
  missed: 'bg-amber-50 outline outline-2 outline-dashed outline-amber-500',
  neutral: '',
};

export default function EmailAnalysisBlock({
  block,
  onSubmit,
  disabled,
  result,
  onContinue,
  continueLabel = 'Dalej',
}: {
  block: ContentBlock;
  onSubmit?: (answer: { selected: string[] }) => void;
  disabled?: boolean;
  result?: EmailResult;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const email = block.email;
  const criteria = useMemo(() => block.criteria ?? [], [block.criteria]);
  const mascot = useMascotReaction();
  // Lista kryteriów domyślnie ZWINIĘTA podczas odpowiadania: zaznaczanie ma iść przez klikanie fragmentów maila, nie
  // czytanie gotowej checklisty obok niego (zdradzałaby z góry, ile/jakich oznak szukać). Ścieżka dla klawiatury i
  // kryteriów bez fragmentu w mailu zostaje - tylko schowana za przyciskiem. W widoku wyniku (readOnly) lista jest
  // od razu widoczna: to już nie checklista do odgadnięcia, tylko rozstrzygnięcie.
  const [listOpen, setListOpen] = useState(false);
  const criteriaListId = useId();
  // Wybór gracza: z odpowiedzi serwera, a gdy jej brak (starszy zapis), z rozstrzygnięcia (detail.criteria[].selected).
  const [selected, setSelected] = useState<string[]>(
    result?.answer?.selected ?? (result?.detail?.criteria ?? []).filter((criterion) => criterion.selected).map((criterion) => criterion.id),
  );
  const [hoverUrl, setHoverUrl] = useState<string | null>(null);
  const [pinnedUrl, setPinnedUrl] = useState<string | null>(null);
  const readOnly = !!result;

  const details = useMemo(() => new Map((result?.detail?.criteria ?? []).map((c) => [c.id, c])), [result]);
  const verdictOf = (id: string): Verdict => {
    const detail = details.get(id);
    if (!readOnly || !detail) return 'neutral';
    if (detail.selected) return detail.correct ? 'hit' : 'false-alarm';
    return detail.correct ? 'missed' : 'neutral';
  };

  // Reakcja maskotki na wynik (tylko w fazie wyniku po zapisie, czyli gdy jest `onContinue`; nie w podglądzie "Wstecz"). Reakcja z
  // treści (schemaVersion 4, reactions.result) ma pierwszeństwo; starsza treść bez niej dostaje ogólne ostrzeżenie przy błędzie.
  useEffect(() => {
    if (!onContinue || !result) return;
    if (result.reaction) mascot.show(result.reaction);
    else if (result.correct === false) mascot.react('wrong');
    // Jednorazowo przy pokazaniu wyniku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!email) return <p className="text-slate-500">Brak treści maila.</p>;

  const toggle = (id: string | undefined) => {
    if (!id || readOnly) return;
    setSelected((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  };
  const criterionOf = (predicate: (c: EmailCriterion) => boolean) => criteria.find(predicate);
  const senderCriterion = criterionOf((c) => c.target?.kind === 'sender');
  const subjectCriterion = criterionOf((c) => c.target?.kind === 'subject');
  const attachmentCriterion = criterionOf((c) => c.target?.kind === 'attachment');
  const { segments, loose } = bodySegments(email.body, criteria, email.links);

  // Fragment maila jako przycisk zaznaczenia (albo zwykły tekst, gdy nie ma kryterium): aria-pressed, w wyniku podświetlenie werdyktu.
  const fragment = (criterionId: string | undefined, content: ReactNode, extra = '') => {
    if (!criterionId) return <span className={extra}>{content}</span>;
    const verdict = verdictOf(criterionId);
    const isSelected = selected.includes(criterionId);
    const criterion = criteria.find((c) => c.id === criterionId);
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => toggle(criterionId)}
        disabled={readOnly}
        title={criterion ? `Zaznacz: ${criterion.label}` : undefined}
        className={`rounded px-1 text-left align-baseline disabled:cursor-default ${extra} ${
          readOnly ? VERDICT_CLASS[verdict] : isSelected ? 'bg-indigo-100 ring-2 ring-indigo-600' : 'hover:bg-amber-100 hover:ring-2 hover:ring-amber-400'
        } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
      >
        {content}
        {readOnly && VERDICT_LABEL[verdict] && <span className="sr-only"> ({VERDICT_LABEL[verdict]})</span>}
      </button>
    );
  };

  const linkNode = (link: { id: string; url: string }, text: string, criterionId?: string) => {
    const verdict = criterionId ? verdictOf(criterionId) : 'neutral';
    const isSelected = !!criterionId && selected.includes(criterionId);
    return (
      <button
        key={`link-${link.id}`}
        type="button"
        aria-pressed={criterionId ? isSelected : undefined}
        onMouseEnter={() => setHoverUrl(link.url)}
        onMouseLeave={() => setHoverUrl(null)}
        onFocus={() => setHoverUrl(link.url)}
        onBlur={() => setHoverUrl(null)}
        onClick={() => {
          // Nigdy nie nawiguje: kliknięcie przypina adres w pasku statusu i (jeśli jest kryterium) zaznacza je.
          setPinnedUrl(link.url);
          toggle(criterionId);
        }}
        className={`rounded px-0.5 text-blue-700 underline decoration-blue-400 ${
          readOnly ? VERDICT_CLASS[verdict] : isSelected ? 'bg-indigo-100 ring-2 ring-indigo-600' : 'hover:bg-amber-100'
        } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
      >
        {text}
        <span className="sr-only"> (adres linku: {link.url})</span>
        {readOnly && VERDICT_LABEL[verdict] && <span className="sr-only"> ({VERDICT_LABEL[verdict]})</span>}
      </button>
    );
  };

  const statusUrl = hoverUrl ?? pinnedUrl;

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      {!readOnly && (
        <p className="mb-3 text-sm text-slate-600">
          Kliknij fragmenty wiadomości, które budzą Twoje podejrzenia (nadawca, temat, link, załącznik, treść), a potem sprawdź odpowiedź.
        </p>
      )}

      <div data-testid="mail-client" className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-100 px-3 py-2" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
          <span className="ml-2 text-xs text-slate-500">Skrzynka odbiorcza</span>
        </div>

        <div className="space-y-1 border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{fragment(subjectCriterion?.id, email.subject)}</h3>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <div className="min-w-0 break-words">
              <span className="text-slate-500">Od: </span>
              {fragment(
                senderCriterion?.id,
                <>
                  <span className="font-medium text-slate-900">{email.fromName}</span>{' '}
                  <span className="text-slate-600">&lt;{email.fromAddress}&gt;</span>
                </>,
              )}
            </div>
            {email.date && <span className="text-xs text-slate-500">{email.date}</span>}
          </div>
          {email.to && (
            <div className="min-w-0 break-words text-slate-600">
              <span className="text-slate-500">Do: </span>
              {email.to}
            </div>
          )}
        </div>

        <div className="whitespace-pre-line px-4 py-4 text-sm leading-relaxed text-slate-800">
          {segments.map((segment, index) => {
            if (segment.link) return <span key={index}>{linkNode(segment.link, segment.text, segment.criterionId)}</span>;
            if (segment.criterionId) return <span key={index}>{fragment(segment.criterionId, segment.text)}</span>;
            return <span key={index}>{segment.text}</span>;
          })}
          {loose.length > 0 && (
            <span className="mt-2 flex flex-col items-start gap-1">
              {loose.map((link) => (
                <span key={link.id}>
                  {linkNode(
                    { id: link.id, url: link.url },
                    link.text || link.url,
                    criteria.find((c) => c.target?.kind === 'link' && c.target.linkId === link.id)?.id,
                  )}
                </span>
              ))}
            </span>
          )}
        </div>

        {email.attachment && (
          <div className="border-t border-slate-200 px-4 py-3">
            {/* Załącznik: tylko zaznaczenie; bez href i download, więc niczego nie pobiera. */}
            {(() => {
              const id = attachmentCriterion?.id;
              const verdict = id ? verdictOf(id) : 'neutral';
              const isSelected = !!id && selected.includes(id);
              return (
                <button
                  type="button"
                  aria-pressed={id ? isSelected : undefined}
                  onClick={() => toggle(id)}
                  disabled={readOnly}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 disabled:cursor-default ${
                    readOnly ? VERDICT_CLASS[verdict] : isSelected ? 'bg-indigo-100 ring-2 ring-indigo-600' : 'hover:bg-amber-100'
                  } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
                >
                  <Paperclip aria-hidden="true" className="h-4 w-4 text-slate-600" />
                  <span>Załącznik: {email.attachment.name}</span>
                  {email.attachment.size && <span className="text-xs text-slate-500">({email.attachment.size})</span>}
                  {readOnly && VERDICT_LABEL[verdict] && <span className="sr-only"> ({VERDICT_LABEL[verdict]})</span>}
                </button>
              );
            })()}
          </div>
        )}

        {/* Pasek statusu jak w przeglądarce: prawdziwy adres linku po najechaniu, fokusie albo kliknięciu (nigdy nie nawigujemy). */}
        <div role="status" aria-live="polite" data-testid="mail-status-bar" className="min-h-[28px] border-t border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-700">
          {statusUrl ? (
            <span>
              Adres linku: <span className="break-all font-mono">{statusUrl}</span>
            </span>
          ) : (
            <span className="text-slate-600">Najedź na link, aby zobaczyć jego prawdziwy adres.</span>
          )}
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold text-slate-900">{readOnly ? 'Kryteria' : 'Zaznaczone oznaki'}</legend>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            aria-controls={criteriaListId}
            className="mb-2 inline-flex min-h-[44px] items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Lista elementów (dla klawiatury)
          </button>
        )}
        <ul id={criteriaListId} hidden={!readOnly && !listOpen} className="space-y-2">
          {criteria.map((criterion) => {
            const verdict = verdictOf(criterion.id);
            const detail = details.get(criterion.id);
            const checked = selected.includes(criterion.id);
            return (
              <li key={criterion.id} className={`rounded px-3 py-2 ${readOnly ? VERDICT_CLASS[verdict] || 'bg-slate-50' : 'bg-slate-50'}`}>
                <label className="flex min-h-[32px] items-start gap-2 text-sm text-slate-900">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(criterion.id)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    {criterion.label}
                    {!readOnly && !criterion.target && <span className="text-xs text-slate-500"> (ogólna oznaka, bez fragmentu w mailu)</span>}
                  </span>
                  {readOnly && verdict !== 'neutral' && (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                      {verdict === 'hit' ? (
                        <Check aria-hidden="true" className="h-4 w-4 text-green-700" />
                      ) : verdict === 'missed' ? (
                        <Info aria-hidden="true" className="h-4 w-4 text-amber-700" />
                      ) : (
                        <X aria-hidden="true" className="h-4 w-4 text-red-700" />
                      )}
                      {VERDICT_LABEL[verdict]}
                    </span>
                  )}
                </label>
                {readOnly && detail?.explanation && <p className="mt-1 pl-6 text-sm text-slate-700">{detail.explanation}</p>}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {readOnly ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className={`text-sm font-medium ${result?.correct ? 'text-green-700' : 'text-slate-800'}`}>
            {result?.correct ? 'Świetnie: wszystkie oznaki trafione.' : 'Nie wszystkie oznaki zostały trafione.'}
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
          onClick={() => onSubmit?.({ selected })}
          className="mt-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Sprawdź odpowiedź
        </button>
      )}
    </div>
  );
}
