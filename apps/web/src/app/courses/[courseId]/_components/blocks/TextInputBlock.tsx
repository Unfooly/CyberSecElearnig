'use client';

import { useId, useRef, useState } from 'react';
import type { ClientProgressBlock, ContentBlock, ContentReaction } from '@/lib/courses-types';
import { TriangleAlert } from 'lucide-react';
import { useHints } from '../player/hints';
import BrowserWindow, { DeceptiveSiteWarning } from './BrowserWindow';

// Zadanie z wpisaniem odpowiedzi ("z podpowiedzią"). Ocena WYŁĄCZNIE na serwerze: klient wysyła tekst próby na BFF
// (`/api/courses/:id/blocks/:blockId/attempt`), a w odpowiedzi dostaje werdykt, liczbę pozostałych prób, kolejną podpowiedź (po błędnej
// próbie) i po wyczerpaniu prób rozwiązanie. Klient nigdy nie zna wzorca, listy poprawnych odpowiedzi ani podpowiedzi z góry (do klienta
// idzie tylko ich liczba). "Dalej" po rozstrzygnięciu to zwykły zapis postępu (onContinue) - CoursePlayer wie, że wynik już jest pokazany
// tutaj (stan `done`), więc NIE pokazuje po nim osobnego ekranu "Blok ukończony." (isExploratory/TEXT_INPUT_GUIDED, patrz handleAnswer).
// Po odświeżeniu stan (próby, odsłonięte podpowiedzi, rozwiązanie) wraca z /start (progress).
// `frame: 'browser'` (feat/browser-evidence): pole jest paskiem adresu w oknie przeglądarki (BrowserWindow.tsx), zła próba to komunikat
// w obrębie okna, a po rozstrzygnięciu okno pokazuje ostrzeżenie o stronie podszywającej się pod bank - nigdy formularza ani pól na dane.

interface AttemptResponse {
  correct: boolean;
  attempt: number;
  attemptsLeft: number;
  done: boolean;
  points?: number;
  hint?: { text: string };
  solution?: { text: string; explanation?: string };
  reaction?: ContentReaction;
}

export default function TextInputBlock({
  block,
  courseId,
  progress,
  onContinue,
  disabled,
  readOnly = false,
  onProgress,
}: {
  block: ContentBlock;
  courseId: string;
  /** Stan z serwera (próby, podpowiedzi, rozwiązanie): z /start albo ostatnia odpowiedź /attempt. */
  progress?: ClientProgressBlock;
  onContinue?: () => void;
  disabled?: boolean;
  /** Podgląd "Wstecz": wynik bez pola i bez wysyłania. */
  readOnly?: boolean;
  /** Zgłasza stan po każdej próbie (do podglądu "Wstecz" w tej samej sesji, bez ponownego pobierania /start). */
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
}) {
  const inputId = useId();
  // Dymek podpowiedzi powłoki (D-093) - `hints` niżej to co innego: odsłonięte podpowiedzi zadania.
  const hintBar = useHints();
  const maxAttempts = block.maxAttempts ?? 4;
  const [value, setValue] = useState('');
  const [attempts, setAttempts] = useState(progress?.attempts ?? 0);
  const [hints, setHints] = useState<string[]>((progress?.revealedHints ?? []).map((hint) => hint.text));
  const [done, setDone] = useState(progress?.done ?? false);
  const [correct, setCorrect] = useState<boolean | undefined>(progress?.correct);
  const [points, setPoints] = useState<number | undefined>(progress?.points);
  const [solution, setSolution] = useState(progress?.solution);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Ostatnia wysłana odpowiedź - w oprawie przeglądarki pokazywana w pasku adresu po rozstrzygnięciu (po odświeżeniu nieznana).
  const [submitted, setSubmitted] = useState<string | null>(null);
  const submitting = useRef(false);
  const browser = block.frame === 'browser';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const answer = value.trim();
    if (!answer || done || submitting.current) return;
    // Brak identyfikatora zadania to błąd treści: pusty id nie może trafić do adresu żądania.
    if (!block.id) {
      setMessage('Nie można sprawdzić odpowiedzi: zadanie nie ma identyfikatora.');
      return;
    }
    submitting.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/blocks/${encodeURIComponent(block.id)}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      const data = (await response.json().catch(() => null)) as (AttemptResponse & { message?: string }) | null;
      if (!response.ok || !data) {
        // `message` z API bywa tablicą (walidator) albo angielskim tekstem: pokazujemy go tylko, gdy jest zwykłym napisem, inaczej stały komunikat.
        setMessage(
          response.status === 429
            ? 'Zbyt wiele prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.'
            : typeof data?.message === 'string' && data.message.length <= 200
              ? data.message
              : 'Nie udało się sprawdzić odpowiedzi.',
        );
        return;
      }
      setAttempts(data.attempt);
      setDone(data.done);
      setSubmitted(answer);
      if (data.done) {
        setCorrect(data.correct);
        setPoints(data.points);
        if (data.solution) setSolution(data.solution);
      }
      onProgress?.({
        type: 'TEXT_INPUT_GUIDED',
        done: data.done,
        attempts: data.attempt,
        ...(data.done ? { correct: data.correct, ...(data.points !== undefined ? { points: data.points } : {}) } : {}),
        ...(data.solution ? { solution: data.solution } : {}),
        revealedHints: [...hints.map((text) => ({ text })), ...(data.hint ? [{ text: data.hint.text }] : [])],
      });
      if (data.hint) {
        setHints((list) => [...list, data.hint!.text]);
        hintBar.notify('hint');
      } else if (data.done && data.reaction) {
        // Reakcja z treści (schemaVersion 4, reactions.result: when correct/incorrect) ma pierwszeństwo nad ogólnym ostrzeżeniem.
        hintBar.show(data.reaction);
      } else if (!data.correct) {
        hintBar.notify('wrong');
      }
      if (!data.correct && !data.done) {
        setMessage(`To nie ta odpowiedź. Pozostało prób: ${data.attemptsLeft}.`);
        setValue('');
      }
    } catch {
      setMessage('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const attemptsLeft = Math.max(0, maxAttempts - attempts);

  const form = !readOnly && !done && (
    <form onSubmit={submit} className={browser ? 'flex min-w-0 flex-1 items-center gap-2' : 'flex flex-wrap items-center gap-2'}>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        // Klawiatura ekranowa na telefonie (feat/player-stage, ramka bez przewijania strony - iOS nie zmniejsza
        // 100dvh, gdy klawiatura się otwiera): bez tego pole zostaje POD klawiaturą, niewidoczne w obszarze
        // treści ramki.
        onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'center' })}
        maxLength={500}
        placeholder={block.placeholder}
        autoComplete="off"
        // Pasek adresu: bez autokorekty i wielkiej litery na telefonie (adres, nie zdanie).
        autoCapitalize={browser ? 'none' : undefined}
        autoCorrect={browser ? 'off' : undefined}
        spellCheck={browser ? false : undefined}
        inputMode={browser ? 'url' : undefined}
        enterKeyHint={browser ? 'go' : undefined}
        // readOnly zamiast disabled na czas wysyłki: pole zachowuje fokus (klawiatura nie wraca na początek strony po każdej próbie).
        readOnly={pending}
        disabled={disabled}
        aria-busy={pending}
        className={
          browser
            ? 'min-h-[44px] min-w-0 flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-muted focus:outline-none disabled:opacity-60'
            : 'min-h-[44px] min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-slate-900 disabled:opacity-60'
        }
      />
      <button
        type="submit"
        disabled={pending || disabled || value.trim().length === 0}
        className={
          browser
            ? 'min-h-[44px] shrink-0 rounded-full bg-ink px-4 text-sm font-medium text-white disabled:opacity-50'
            : 'min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50'
        }
      >
        Sprawdź
      </button>
    </form>
  );

  // Adres pokazywany po rozstrzygnięciu: wpisana (poprawna) odpowiedź albo rozwiązanie po wyczerpaniu prób.
  const shownAddress = done ? (correct ? (submitted ?? undefined) : solution?.text) : undefined;

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Zadanie</p>
      <label htmlFor={inputId} className="mb-3 block text-lg text-slate-900">
        {block.prompt}
      </label>

      {browser ? (
        <BrowserWindow
          tabTitle={shownAddress ?? 'Nowa karta'}
          addressBar={
            form || (
              <span data-testid="browser-address" className="min-h-[44px] min-w-0 flex-1 break-all py-2.5 text-sm text-ink">
                {shownAddress}
              </span>
            )
          }
        >
          {done ? (
            <DeceptiveSiteWarning address={shownAddress} />
          ) : message ? (
            // Zła próba (albo błąd sieci) jak strona błędu przeglądarki - w obrębie okna.
            <div role="status" data-testid="browser-error" className="flex flex-col items-center gap-2 py-4 text-center">
              <TriangleAlert aria-hidden="true" className="h-8 w-8 text-warning" />
              <p className="text-sm font-medium text-ink">{message}</p>
            </div>
          ) : pending ? null : (
            // W trakcie wysyłki pusto (bez mignięcia instrukcji między komunikatem złej próby a odpowiedzią).
            <p className="py-6 text-center text-sm text-muted">Wpisz adres w pasku u góry i naciśnij „Sprawdź”.</p>
          )}
        </BrowserWindow>
      ) : (
        form
      )}

      {!done && !readOnly && (
        <p className="mt-2 text-sm text-slate-600" aria-live="polite">
          Próba {Math.min(attempts + 1, maxAttempts)} z {maxAttempts}
          {attempts > 0 && ` (pozostało: ${attemptsLeft})`}.
        </p>
      )}
      {message && !browser && (
        <p role="status" className="mt-2 text-sm font-medium text-red-700">
          {message}
        </p>
      )}

      {hints.length > 0 && (
        <section aria-label="Podpowiedzi" className="mt-3 rounded bg-amber-50 p-3 ring-1 ring-amber-200">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">Podpowiedź</h3>
          <ul className="space-y-1 text-sm text-slate-800">
            {hints.map((hint, index) => (
              <li key={index}>{hint}</li>
            ))}
          </ul>
        </section>
      )}

      {done && (
        <div className="mt-4" data-testid="text-input-result">
          {correct ? (
            <p className="text-lg font-medium text-green-700">
              Poprawna odpowiedź!
              {typeof points === 'number' && points < 1 && <span className="text-sm text-slate-700"> Wynik: {Math.round(points * 100)}%.</span>}
            </p>
          ) : (
            <div className="rounded bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="font-medium text-slate-900">Wykorzystano wszystkie próby.</p>
              {solution && (
                <>
                  <p className="mt-1 text-slate-800">
                    Prawidłowa odpowiedź: <span className="font-semibold">{solution.text}</span>
                  </p>
                  {solution.explanation && <p className="mt-1 text-sm text-slate-700">{solution.explanation}</p>}
                </>
              )}
            </div>
          )}
          {!readOnly && onContinue && (
            <button type="button" onClick={onContinue} disabled={disabled} className="mt-3 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Dalej
            </button>
          )}
        </div>
      )}
    </div>
  );
}
