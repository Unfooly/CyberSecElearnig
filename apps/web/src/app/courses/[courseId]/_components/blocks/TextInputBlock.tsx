'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ClientProgressBlock, ContentBlock, ContentReaction } from '@/lib/courses-types';
import { TriangleAlert } from 'lucide-react';
import { useHints } from '../player/hints';
import { urlDomainMarks } from '@cyberszkolo/content';
import BrowserWindow, { DeceptiveSiteWarning, FakeLoginPage } from './BrowserWindow';
import AddressMarker, { type MarkStep } from './AddressMarker';
import MonitorStage from '../player/MonitorStage';
import DesktopStage from '../player/DesktopStage';
import { useBarAction, useHasBarAction } from '../player/bar-action';

// Zadanie z wpisaniem odpowiedzi ("z podpowiedzią"). Ocena WYŁĄCZNIE na serwerze: klient wysyła tekst próby na BFF
// (`/api/courses/:id/blocks/:blockId/attempt`), a w odpowiedzi dostaje werdykt, liczbę pozostałych prób, kolejną podpowiedź (po błędnej
// próbie) i po wyczerpaniu prób rozwiązanie. Klient nigdy nie zna wzorca, listy poprawnych odpowiedzi ani podpowiedzi z góry (do klienta
// idzie tylko ich liczba). Po rozstrzygnięciu blok zgłasza gotowość (onReady), a zwykły zapis postępu rusza „Dalej” w dolnym pasku -
// jedyne przejście dalej (D-106). CoursePlayer wie, że wynik już jest pokazany tutaj (stan `done`), więc NIE pokazuje po nim osobnego
// ekranu "Blok ukończony." (isExploratory/TEXT_INPUT_GUIDED, patrz handleAnswer).
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
  onReady,
  disabled,
  readOnly = false,
  onProgress,
  contentBase = '',
}: {
  block: ContentBlock;
  courseId: string;
  /** Baza zasobów (tło `background` zadania na pulpicie, D-184). */
  contentBase?: string;
  /** Stan z serwera (próby, podpowiedzi, rozwiązanie): z /start albo ostatnia odpowiedź /attempt. */
  progress?: ClientProgressBlock;
  /** true = zadanie rozstrzygnięte - „Dalej” w pasku aktywny (D-106). */
  onReady?: (ready: boolean) => void;
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
  // Komentarz do wyniku z treści (reactions.result). W monitorze zostaje na stronie pod wynikiem (D-193, uwaga właściciela 2026-11-21:
  // wyjaśnienie o poddomenie i nadawcy ma być przy zadaniu - w dymku znikało po 5 s); poza monitorem jak dotąd w dymku.
  const [reactionText, setReactionText] = useState<string | undefined>(progress?.reaction?.text);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Ostatnia wysłana odpowiedź - w oprawie przeglądarki pokazywana w pasku adresu po rozstrzygnięciu (po odświeżeniu nieznana).
  const [submitted, setSubmitted] = useState<string | null>(null);
  const submitting = useRef(false);
  const browser = block.frame === 'browser';
  const monitor = block.frame === 'monitor';
  // Rozkład adresu (D-181): po pierwszej próbie albo rozstrzygnięciu (także po odświeżeniu) domena jest już zaznaczona.
  const marks = monitor && block.markUrl ? urlDomainMarks(block.markUrl) : null;
  const [markStep, setMarkStep] = useState<MarkStep>((progress?.done ?? false) || (progress?.attempts ?? 0) > 0 ? 2 : 0);
  // Komunikat kroku zaznaczania: błąd (czerwony) albo potwierdzenie udanego kroku - ogłaszane w role="status".
  const [markMessage, setMarkMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const inputRef = useRef<HTMLInputElement>(null);
  // Po zaznaczeniu domeny przyciski separatorów znikają - fokus na pole odpowiedzi (inaczej spadłby na <body>).
  const focusInputAfterMark = useRef(false);
  useEffect(() => {
    if (markStep === 2 && focusInputAfterMark.current) {
      focusInputAfterMark.current = false;
      inputRef.current?.focus();
    }
  }, [markStep]);

  function pick(index: number) {
    if (!marks || !block.markUrl) return;
    const ch = block.markUrl[index];
    const wrong = (text: string) => {
      setMarkMessage({ text, error: true });
      hintBar.notify('wrong');
    };
    if (markStep === 0) {
      if (index === marks.slash) {
        setMarkStep(1);
        setMarkMessage({ text: 'Ukośnik zaznaczony.', error: false });
      } else {
        wrong(
          index < marks.hostStart
            ? 'To ukośnik z „https://” – podwójny. Szukaj pierwszego POJEDYNCZEGO „/”.'
            : ch === '/'
              ? 'To nie pierwszy pojedynczy ukośnik. Szukaj tego, który stoi zaraz po nazwie strony.'
              : 'To kropka. Najpierw znajdź pierwszy pojedynczy ukośnik „/”.',
        );
      }
      return;
    }
    if (markStep === 1) {
      if (index === marks.dot) {
        focusInputAfterMark.current = true;
        setMarkStep(2);
        setMarkMessage({ text: 'Domena zaznaczona.', error: false });
      } else {
        wrong(
          ch === '/'
            ? 'Teraz szukasz kropki „.” na lewo od zaznaczonego ukośnika.'
            : index > marks.slash
              ? 'Ta kropka jest za ukośnikiem. Idź od zaznaczonego „/” w lewo.'
              : 'To nie ta kropka. Licz od ukośnika w lewo: pierwsza kropka, potem druga.',
        );
      }
    }
  }

  // Rozstrzygnięte (także po odświeżeniu - `done` z /start): „Dalej” w pasku aktywny.
  useEffect(() => {
    if (!readOnly && done) onReady?.(true);
    // onReady celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, readOnly]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
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
        // Komentarz do wyniku (D-193) - do podglądu „Wstecz” i ponownego montowania w tej samej sesji.
        ...(data.done && data.reaction ? { reaction: data.reaction } : {}),
      });
      if (data.hint) {
        setHints((list) => [...list, data.hint!.text]);
        hintBar.notify('hint');
      } else if (data.done && data.reaction) {
        // Reakcja z treści (schemaVersion 4, reactions.result: when correct/incorrect) ma pierwszeństwo nad ogólnym ostrzeżeniem.
        // W monitorze zostaje na stronie pod wynikiem (D-193); przy złym wyniku dymek daje samo ostrzeżenie.
        setReactionText(data.reaction.text);
        if (!monitor) hintBar.show(data.reaction);
        else if (!data.correct) hintBar.notify('wrong');
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

  // „Sprawdź” w miejscu „Dalej” (D-187): aktywny, gdy pole jest widoczne (po zaznaczeniu domeny) i niepuste; po rozstrzygnięciu pasek wraca
  // do „Dalej” (onReady). Enter w polu dalej wysyła odpowiedź. Własny przycisk przy polu tylko bez paska odtwarzacza.
  const inBar = useHasBarAction();
  const fieldShown = !(monitor && marks) || markStep === 2;
  useBarAction(
    readOnly || done ? null : { label: 'Sprawdź', enabled: fieldShown && value.trim().length > 0 && !pending && !disabled, run: () => void submit() },
  );

  const form = !readOnly && !done && (
    <form onSubmit={submit} className={browser ? 'flex min-w-0 flex-1 items-center gap-2' : 'flex flex-wrap items-center gap-2'}>
      <input
        ref={inputRef}
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
        // Pasek adresu i domena w monitorze: bez autokorekty i wielkiej litery na telefonie (adres, nie zdanie).
        autoCapitalize={browser || monitor ? 'none' : undefined}
        autoCorrect={browser || monitor ? 'off' : undefined}
        spellCheck={browser || monitor ? false : undefined}
        inputMode={browser || monitor ? 'url' : undefined}
        enterKeyHint={browser || monitor ? 'go' : undefined}
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
      {!inBar && (
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
      )}
    </form>
  );

  const hintsSection = hints.length > 0 && (
    <section aria-label="Podpowiedzi" className="mt-3 rounded bg-amber-50 p-3 ring-1 ring-amber-200">
      <h3 className="mb-1 text-sm font-semibold text-amber-900">Podpowiedź</h3>
      <ul className="space-y-1 text-sm text-slate-800">
        {hints.map((hint, index) => (
          <li key={index}>{hint}</li>
        ))}
      </ul>
    </section>
  );
  const resultSection = done && (
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
      {/* Także w podglądzie „Wstecz” (zwykła karta) - komentarz jest częścią wyniku. */}
      {monitor && reactionText && (
        <p data-testid="text-input-reaction" className="mt-2 text-sm leading-relaxed text-slate-800">
          {reactionText}
        </p>
      )}
    </div>
  );

  // Strona w monitorze z rozkładem adresu (D-181): najpierw „/”, potem „.”, dopiero wtedy pole na domenę. Podgląd „Wstecz” - jak niżej.
  if (monitor && !readOnly) {
    const step: MarkStep = marks ? markStep : 2;
    const instruction =
      step === 0
        ? 'Krok 1 z 3: kliknij w pasku adresu pierwszy pojedynczy ukośnik „/” – ten zaraz po nazwie strony.'
        : step === 1
          ? 'Krok 2 z 3: od zaznaczonego ukośnika idź w lewo i kliknij drugą kropkę „.”.'
          : done
            ? null
            : 'Krok 3 z 3: zaznaczony fragment to domena. Wpisz ją poniżej i naciśnij „Sprawdź”.';
    // Etykieta pola dopiero, gdy pole istnieje (krok 3) - wcześniej zwykły akapit z poleceniem.
    const promptNode =
      step === 2 ? (
        <label htmlFor={inputId} className="block text-base text-slate-900" data-monitor-prompt>
          {block.prompt}
        </label>
      ) : (
        <p className="block text-base text-slate-900" data-monitor-prompt>
          {block.prompt}
        </p>
      );
    const task = (
      <>
        {instruction && (
          <p data-testid="mark-instruction" className="text-base font-semibold text-ink">
            {instruction}
          </p>
        )}
        {/* Po rozstrzygnięciu ten sam (stały) region ogłasza czytnikowi komentarz z treści (D-193; dotąd ogłaszał go dymek) - widoczna
            wersja jest niżej, w wyniku; region montowany razem z treścią nie zostałby ogłoszony. */}
        <p role="status" className={done ? 'sr-only' : `mt-1 min-h-[1.25rem] text-sm font-medium ${message || markMessage.error ? 'text-red-700' : 'text-green-700'}`}>
          {done ? (reactionText ?? '') : message || markMessage.text}
        </p>
        {step === 2 && form}
        {step === 2 && !done && (
          <p className="mt-2 text-sm text-slate-600" aria-live="polite">
            Próba {Math.min(attempts + 1, maxAttempts)} z {maxAttempts}
            {attempts > 0 && ` (pozostało: ${attemptsLeft})`}.
          </p>
        )}
        {hintsSection}
        {resultSection}
      </>
    );
    const addressBar =
      marks && block.markUrl ? (
        <AddressMarker url={block.markUrl} step={step} slash={marks.slash} dot={marks.dot} onPick={pick} />
      ) : (
        <span className="min-w-0 flex-1 break-all py-2.5 text-sm text-ink">{block.markUrl ?? ''}</span>
      );

    // Zadanie wbudowane w fałszywą stronę na pulpicie (D-184, uwaga właściciela 2026-11-20): scena komputera z przybliżeniem pod
    // oknem przeglądarki, w oknie pasek adresu do zaznaczenia, pasek zadania i pod nim fałszywa strona logowania (obrazek, bez pól).
    if (block.background) {
      return (
        <DesktopStage contentBase={contentBase} background={block.background} screen={block.backgroundScreen} label="Przeglądarka">
          <BrowserWindow tabTitle={block.page?.tabTitle ?? 'Nowa karta'} addressBar={addressBar} bodyClassName="">
            <div data-testid="page-task" className="border-b border-accent/30 bg-accent-soft px-4 py-3">
              {promptNode}
              <div className="mt-2">{task}</div>
            </div>
            {block.page && <FakeLoginPage page={block.page} compact />}
          </BrowserWindow>
        </DesktopStage>
      );
    }

    return (
      <MonitorStage label="Przeglądarka">
        <div className="flex flex-col gap-3">
          {promptNode}
          <BrowserWindow
            // Tytuł karty neutralny (nie z konkretnego modułu); po zaznaczeniu - zaznaczona domena.
            tabTitle={step === 2 && marks ? marks.domain : 'Nowa karta'}
            addressBar={addressBar}
          >
            {task}
            {block.page && (
              <div className="mt-3">
                <FakeLoginPage page={block.page} compact />
              </div>
            )}
          </BrowserWindow>
        </div>
      </MonitorStage>
    );
  }

  // Adres pokazywany po rozstrzygnięciu: wpisana (poprawna) odpowiedź albo rozwiązanie po wyczerpaniu prób.
  const shownAddress = done ? (correct ? (submitted ?? undefined) : solution?.text) : undefined;

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Zadanie</p>
      <label htmlFor={inputId} className="mb-3 block text-lg text-slate-900">
        {block.prompt}
      </label>
      {/* Podgląd „Wstecz” zadania z monitora (D-181): adres był w pasku przeglądarki, nie w poleceniu - pokazujemy go tutaj. */}
      {block.markUrl && (
        <p data-testid="text-input-address" className="mb-3 break-all font-mono text-sm text-ink">
          {block.markUrl}
        </p>
      )}

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

      {hintsSection}

      {resultSection}
    </div>
  );
}
