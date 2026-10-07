'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Gavel, Monitor, NotebookPen, X } from 'lucide-react';
import type { ChallengeResponse, ClientNote, ClientProgressBlock, ContentBlock, EvidenceSummary, InterrogationChallenge, ResultDetail } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useSfx } from '@/lib/sfx';
import { flyEvidence, prefersReducedMotion } from '@/lib/motion';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { NoteKindIcon, useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { DEFAULT_HINT, useCompleteHint, useHints } from '../player/hints';
import { useBlockingOverlayOpen, useOverlayLayer } from '../player/overlay-stack';
import Hint from '../player/Hint';
import { PlayerBubble, TypingBubble, typingDelayMs } from './DialogueBlock';
import { DossierDocuments, useDossier } from './DossierBlock';

// Przesłuchanie (INTERROGATION, D-118/D-119). Wątek jak komunikator (DialogueBlock, D-087): gracz wybiera pytanie z chipów, postać
// „pisze” i odpowiada kwestiami. Kwestię postaci można zaznaczyć (klik, Enter): pod nią akcje
//  - „Dodaj do notatek” (klawisz N) - przy każdej kwestii (D-129); kwestia-fragment trafia do notatnika (dowód, gdy `evidence`), jak
//    hotspot, a zwykła kwestia - komunikat NOT_NEW, bez notatki i dowodu;
//  - „Podważ” (klawisz P) - przy KAŻDEJ kwestii (klient nie wie, która kłamie): wybór dowodu z notatnika (notatki z odnośnikiem `ref`,
//    czyli zapisane przez serwer), serwer sprawdza (/challenge). Trafienie: postać się przyznaje (dymek przyznania), notatka sprzeczności
//    i licznik dowodów z serwera. Pudło: kwestia zostaje oznaczona. Jedna próba na kwestię.
// Pytanie z `opensDocuments` otwiera konsolę (dokumenty jak teczka - DossierDocuments): po jego ostatniej kwestii konsola otwiera się
// sama, potem przycisk w stopce. Gotowe („Dalej” w pasku): wymagane pytania zadane i - po pytaniu konsoli - wszystkie dokumenty
// otwarte i wymagane wiersze zakreślone. Odpowiedź dla serwera: { asked, noted (fragmenty + wiersze konsoli), opened }.
// Po odświeżeniu stan podważeń przychodzi w postępie (`challenges`): pytania z podważonymi kwestiami wracają do wątku jako zadane (serwer
// odrzuca zapis z podważeniem kwestii niezadanego pytania). Wynik po zapisie i podgląd „Wstecz”: InterrogationResult.

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;
// „Dodaj do notatek” przy kwestii bez fragmentu (D-129): bez notatki, dowodu i kary.
export const NOT_NEW = 'To nie wnosi nic nowego.';
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type Line = NonNullable<NonNullable<ContentBlock['questions']>[number]['lines']>[number];
type Message =
  | { key: string; kind: 'player'; text: string }
  | { key: string; kind: 'line'; line: Line }
  | { key: string; kind: 'admission'; lineId: string; text: string }
  | { key: string; kind: 'opening'; text: string }
  | { key: string; kind: 'typing' };

export interface InterrogationAnswer {
  asked: string[];
  noted: string[];
  opened?: string[];
}

/** Tab i Shift+Tab nie wychodzą poza okno dialogowe (wybór dowodu, konsola). */
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => !item.closest('[hidden]'));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function InterrogationBlock({
  block,
  courseId,
  contentBase,
  onSubmit,
  onReady,
  progress,
  onProgress,
  onEvidence,
  myAvatarUrl = null,
  myInitials,
}: {
  block: ContentBlock;
  courseId: string;
  contentBase: string;
  onSubmit: (answer: InterrogationAnswer) => void;
  onReady: (submit: (() => void) | null) => void;
  /** Stan z serwera (podważenia w trakcie bloku) - z /start. */
  progress?: ClientProgressBlock;
  /** Zgłasza podważenia do stanu wyników (podgląd, odświeżenie w tej samej sesji). */
  onProgress?: (patch: Partial<ClientProgressBlock>) => void;
  /** Liczby dowodów z serwera po trafionym podważeniu (zebrana sprzeczność; suma bez zmian - stały mianownik, D-130). */
  onEvidence?: (summary: EvidenceSummary) => void;
  myAvatarUrl?: string | null;
  myInitials?: string;
}) {
  const questions = block.questions ?? [];
  const documents = block.documents ?? [];
  const character = block.character;
  const { notes, addNote } = useNotes();
  const evidence = useEvidence();
  const hints = useHints();
  const reducedMotion = usePrefersReducedMotion();
  const play = useSfx(['msg-send', 'msg-receive']);
  const bannerHint = hints.hint ?? block.tip ?? DEFAULT_HINT.INTERROGATION;
  const avatarUrl = contentAssetUrl(contentBase, character?.avatar, 'image');
  const [avatarFailed, setAvatarFailed] = useState(false);

  const initialChallenges = progress?.challenges ?? [];
  const [openingShown, setOpeningShown] = useState(!character?.opening || initialChallenges.length > 0);
  // Po odświeżeniu: pytania z podważonymi kwestiami (kolejność z treści) od razu w wątku, w całości.
  const [asked, setAsked] = useState<{ id: string; shown: number }[]>(() =>
    questions
      .filter((question) => (question.lines ?? []).some((line) => line.id && initialChallenges.some((challenge) => challenge.lineId === line.id)))
      .map((question) => ({ id: question.id, shown: (question.lines ?? []).length })),
  );
  const [challenges, setChallenges] = useState<InterrogationChallenge[]>(initialChallenges);
  const [noted, setNoted] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [status, setStatus] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consolePending, setConsolePending] = useState(false);
  const overlayOpen = useBlockingOverlayOpen();
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const dossier = useDossier(documents, block.id, false);
  const logRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const consoleButtonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const linesOf = (id: string): Line[] => questions.find((question) => question.id === id)?.lines ?? [];
  const isComplete = (entry: { id: string; shown: number }) => entry.shown >= linesOf(entry.id).length;
  const askedIds = asked.filter(isComplete).map((entry) => entry.id);
  const current = asked.find((entry) => !isComplete(entry)) ?? null;
  const pendingLine = !openingShown ? (character?.opening ?? null) : current ? (linesOf(current.id)[current.shown]?.text ?? null) : null;
  const typing = pendingLine !== null;
  const pendingKey = !openingShown ? 'opening' : current ? `${current.id}#${current.shown}` : '';
  const pendingKeyRef = useRef(pendingKey);
  pendingKeyRef.current = pendingKey;

  const opener = questions.find((question) => question.opensDocuments === true);
  const consoleAvailable = !!opener && askedIds.includes(opener.id) && documents.length > 0;
  const required = requiredItemIds(questions, undefined);
  const askedRequired = required.filter((id) => askedIds.includes(id)).length;
  // Podważenie w toku blokuje „Dalej” - zapis bloku nie może wyprzedzić odpowiedzi /challenge.
  const ready = askedRequired >= required.length && (!consoleAvailable || dossier.ready) && !typing && !pending;
  useCompleteHint(block.reactions?.complete, ready, false);

  useEffect(() => {
    onReady(ready ? () => onSubmit({ asked: askedIds, noted: [...noted, ...(consoleAvailable ? dossier.noted : [])], ...(consoleAvailable ? { opened: dossier.opened } : {}) }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, asked, noted, dossier.noted, dossier.opened]);

  // Liczby dowodów z serwera po trafionym podważeniu zastępują stan licznika, a EvidenceProvider czyści wtedy lokalne (niezapisane)
  // dowody - fragmenty i wiersze konsoli tego bloku dopisujemy z powrotem PRZED malowaniem (addPending pomija duplikaty).
  useLayoutEffect(() => {
    if (!block.id) return;
    const fragmentEvidence = questions
      .flatMap((question) => question.lines ?? [])
      .filter((line) => line.id && line.fragment?.evidence && noted.includes(line.id))
      .map((line) => `${block.id}.${line.id}`);
    for (const key of [...fragmentEvidence, ...dossier.noted.map((id) => `${block.id}.${id}`)]) evidence.addPending(key);
    // Tylko na zmianę liczb z serwera (nowy `addPending`); bieżące dopisywanie robią addFragment/mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.summary]);

  // Okna dialogowe: fokus do środka przy otwarciu (pierwszy dowód; w konsoli - zamknięcie), po zamknięciu - z powrotem na kwestię/przycisk.
  useEffect(() => {
    if (pickerFor) pickerRef.current?.querySelector<HTMLElement>('[data-testid="interrogation-evidence"]')?.focus();
  }, [pickerFor]);
  useEffect(() => {
    if (consoleOpen) consoleRef.current?.querySelector<HTMLElement>('[data-console-close]')?.focus();
  }, [consoleOpen]);

  function closePicker() {
    const lineId = pickerFor;
    setPickerFor(null);
    // Konsola zaraz otworzy się sama (czekała na zamknięcie wyboru) - fokus dostaje ona, nie kwestia pod jej oknem.
    if (lineId && !consolePending) window.setTimeout(() => lineRefs.current[lineId]?.focus(), 0);
  }
  function closeConsole() {
    setConsoleOpen(false);
    window.setTimeout(() => consoleButtonRef.current?.focus(), 0);
  }

  // Esc: najpierw wybór dowodu, potem konsola (jedna warstwa kaskady powłoki).
  useOverlayLayer('blockModal', pickerFor !== null || consoleOpen, () => {
    if (pickerFor !== null) closePicker();
    else closeConsole();
  });

  // „Pisanie” postaci - jak w dialogu: każda kwestia po typingDelayMs; klik we wskaźnik albo Spacja - od razu.
  useEffect(() => {
    if (!typing) return undefined;
    const timer = window.setTimeout(() => reveal(true, pendingKey), typingDelayMs(pendingLine ?? '', reducedMotion || prefersReducedMotion()));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  function reveal(withSound: boolean, forKey: string = pendingKeyRef.current) {
    if (!forKey || forKey !== pendingKeyRef.current) return;
    pendingKeyRef.current = '';
    if (withSound) play('msg-receive');
    if (!openingShown) {
      setOpeningShown(true);
      setAnnouncement(`${speakerName}: ${character?.opening ?? ''}`);
      return;
    }
    if (!current) return;
    const shown = current.shown + 1;
    const text = linesOf(current.id)[current.shown]?.text ?? '';
    setAnnouncement(`${speakerName}: ${text}`);
    setAsked((list) => list.map((entry) => (entry.id === current.id ? { ...entry, shown } : entry)));
    // Po ostatniej kwestii pytania konsoli - konsola otwiera się sama (pierwszy raz).
    if (shown >= linesOf(current.id).length && current.id === opener?.id) setConsolePending(true);
  }

  // Samoczynne otwarcie konsoli czeka, aż nic jej nie zasłania (B-136, code review): przy otwartym notatniku okno modalne zrobiłoby inert
  // pasek z przyciskiem „Notatnik” i fokus po zamknięciu notatnika wylądowałby na body.
  // Konsola otwarta w międzyczasie przyciskiem - oczekujące otwarcie przepada (inaczej wyskoczyłaby drugi raz po jej zamknięciu).
  useEffect(() => {
    if (!consolePending) return;
    if (consoleOpen) {
      setConsolePending(false);
      return;
    }
    if (overlayOpen) return;
    setConsolePending(false);
    setConsoleOpen(true);
  }, [consolePending, consoleOpen, overlayOpen]);

  function ask(id: string) {
    if (typing || asked.some((entry) => entry.id === id)) return;
    setAsked((list) => [...list, { id, shown: 0 }]);
    setSelected(null);
    play('msg-send');
    footerRef.current?.focus();
  }

  const challengeOf = (lineId: string) => challenges.find((challenge) => challenge.lineId === lineId);
  const evidenceNotes = notes.filter((note): note is ClientNote & { ref: string } => typeof note.ref === 'string' && note.blockId !== block.id);

  function addFragment(line: Line, from?: Element | null) {
    if (!line.id || !block.id) return;
    // „Dodaj do notatek” jest przy KAŻDEJ kwestii (D-129) - sam przycisk nie zdradza, które kwestie coś wnoszą. Kwestia bez fragmentu nie
    // trafia do notatnika i nie jest dowodem (bez kary).
    if (!line.fragment) {
      setStatus(NOT_NEW);
      return;
    }
    if (noted.includes(line.id)) {
      setStatus('Ta kwestia jest już w notatniku.');
      return;
    }
    setNoted((list) => [...list, line.id!]);
    addNote({ blockId: block.id, text: line.fragment.note.text, kind: line.fragment.note.kind });
    if (line.fragment.evidence) {
      evidence.addPending(`${block.id}.${line.id}`);
      hints.notify('evidence');
    }
    flyEvidence(from ?? undefined, line.fragment.note.text);
    setStatus('Kwestia trafiła do notatnika.');
    // Przycisk akcji znika - fokus wraca na kwestię.
    const lineId = line.id;
    window.setTimeout(() => lineRefs.current[lineId]?.focus(), 0);
  }

  function openPicker(lineId: string) {
    if (pendingRef.current) return;
    if (challengeOf(lineId)) {
      setStatus('Ta kwestia była już podważona.');
      return;
    }
    if (evidenceNotes.length === 0) {
      setStatus('W notatniku nie ma jeszcze dowodów z wcześniejszych scen.');
      return;
    }
    setPickerFor(lineId);
  }

  async function challenge(lineId: string, note: ClientNote & { ref: string }) {
    // Ref, nie stan: dwa kliknięcia w tym samym ticku wysłałyby dwa żądania (drugie - 400 „już podważona”).
    if (!block.id || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus('');
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/blocks/${encodeURIComponent(block.id)}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, noteRef: note.ref }),
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = (await response.json().catch(() => null)) as (ChallengeResponse & { message?: string }) | null;
      if (!response.ok || !data) {
        setStatus(
          response.status === 429
            ? 'Zbyt wiele prób w krótkim czasie. Odczekaj chwilę.'
            : // 400 bywa odpowiedzią na podważenie już zapisane (np. po zerwanym połączeniu) - stan pokaże odświeżenie strony.
              'Nie udało się podważyć kwestii. Odśwież stronę, aby zobaczyć zapisany wynik.',
        );
        closePicker();
        return;
      }
      const correct = data.correct === true;
      const result: InterrogationChallenge = { lineId, correct, ...(correct && data.line ? { line: data.line } : {}) };
      const next = [...challenges.filter((c) => c.lineId !== lineId), result];
      setChallenges(next);
      onProgress?.({ type: 'INTERROGATION', challenges: next });
      closePicker();
      if (correct) {
        if (data.note) addNote(data.note);
        if (data.evidence) onEvidence?.(data.evidence);
        hints.notify('evidence');
        play('msg-receive');
        setStatus('Trafiony dowód - zeznanie się nie trzyma.');
        if (data.line) setAnnouncement(`${speakerName} (przyznaje): ${data.line.text}`);
      } else {
        hints.notify('wrong');
        setStatus('Ten dowód nie podważa tej kwestii.');
      }
    } catch {
      setStatus('Nie udało się połączyć z serwerem. Odśwież stronę, aby zobaczyć zapisany wynik.');
      closePicker();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function onLineKeyDown(event: KeyboardEvent<HTMLButtonElement>, line: Line) {
    if (event.altKey || event.ctrlKey || event.metaKey || !line.id) return;
    const key = event.key.toLowerCase();
    if (key === 'n') {
      event.preventDefault();
      addFragment(line, event.currentTarget);
    } else if (key === 'p') {
      event.preventDefault();
      openPicker(line.id);
    }
  }

  function skipOnSpace(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' || !typing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    reveal(true);
  }

  // Wiadomości wątku: otwarcie, pytania gracza, kwestie postaci (z przyznaniem po trafionym podważeniu tuż pod kwestią).
  const messages: Message[] = [];
  if (character?.opening && openingShown) messages.push({ key: 'opening', kind: 'opening', text: character.opening });
  for (const entry of asked) {
    const question = questions.find((candidate) => candidate.id === entry.id);
    if (!question) continue;
    messages.push({ key: `${entry.id}-q`, kind: 'player', text: question.text });
    linesOf(entry.id)
      .slice(0, entry.shown)
      .forEach((line, index) => {
        messages.push({ key: `${entry.id}-${index}`, kind: 'line', line });
        const hit = line.id ? challengeOf(line.id) : undefined;
        if (line.id && hit?.correct && hit.line) messages.push({ key: `${entry.id}-${index}-admission`, kind: 'admission', lineId: line.id, text: hit.line.text });
      });
  }
  if (typing) messages.push({ key: `typing-${pendingKey}`, kind: 'typing' });
  const lastKey = messages[messages.length - 1]?.key ?? '';

  useEffect(() => {
    const log = logRef.current;
    if (!log || messages.length === 0) return;
    if (stickToBottomRef.current) {
      log.scrollTo({ top: log.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey, messages.length]);

  function handleScroll() {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
    const scrolledUp = log.scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = log.scrollTop;
    if (scrolledUp) stickToBottomRef.current = atBottom;
    else if (atBottom) stickToBottomRef.current = true;
    if (stickToBottomRef.current) setHasNewMessages(false);
  }

  const speakerName = character?.name ?? 'Postać';
  const available = questions.filter((question) => !asked.some((entry) => entry.id === question.id));
  const pickerLine = pickerFor ? questions.flatMap((question) => question.lines ?? []).find((line) => line.id === pickerFor) : undefined;
  const avatar = (show: boolean) =>
    show && avatarUrl && !avatarFailed ? (
      // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
      <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" onError={() => setAvatarFailed(true)} />
    ) : (
      <span aria-hidden="true" className="h-8 w-8 shrink-0" />
    );

  return (
    <div onKeyDown={skipOnSpace} data-testid="interrogation-block" className="relative flex min-h-0 w-full flex-1 flex-col [container-type:size]">
      <Hint variant="bar" text={bannerHint} />
      {character && (
        <div className="mx-auto mb-3 flex w-full max-w-[760px] shrink-0 items-center gap-3 [@media(max-height:500px)]:hidden">
          {avatarUrl && !avatarFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
            <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" onError={() => setAvatarFailed(true)} />
          )}
          <p className="text-sm text-muted">
            Przesłuchanie: <span className="font-semibold text-ink">{character.name}</span>
            {character.role && <span>, {character.role}</span>}
          </p>
        </div>
      )}

      {/* Czytnik: ogłaszane są wyłącznie nowe wiadomości postaci (region niżej) - zaznaczenie kwestii, akcje i znaczniki nie. */}
      <p className="sr-only" aria-live="polite" data-testid="interrogation-announcer">
        {announcement}
      </p>
      <div
        ref={logRef}
        role="log"
        aria-live="off"
        aria-label="Przebieg przesłuchania"
        tabIndex={0}
        onScroll={handleScroll}
        className={`relative min-h-0 flex-1 overflow-y-auto outline-none ${FOCUS_RING}`}
      >
        <ol data-testid="interrogation-thread" className="mx-auto w-full max-w-[760px] pb-1">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const speakerOf = (m: Message | undefined) => (m ? (m.kind === 'player' ? 'player' : 'character') : null);
            const speaker = speakerOf(message);
            const gap = !previous ? '' : speakerOf(previous) === speaker ? 'mt-1.5' : 'mt-3';
            // Avatar postaci przy ostatniej wiadomości grupy (jak w dialogu); wskaźnik pisania ma własny.
            const lastOfGroup = !next || speakerOf(next) !== speaker || next.kind === 'typing';
            if (message.kind === 'typing') {
              return (
                <li key={message.key} className={gap}>
                  <TypingBubble avatarUrl={avatarUrl} avatarFailed={avatarFailed} onAvatarError={() => setAvatarFailed(true)} reducedMotion={reducedMotion} onSkip={() => reveal(true)} />
                </li>
              );
            }
            if (message.kind === 'player') {
              return (
                <li key={message.key} className={gap} data-speaker="player">
                  <PlayerBubble avatarUrl={myAvatarUrl} initials={myInitials} showAvatar={lastOfGroup}>
                    {message.text}
                  </PlayerBubble>
                </li>
              );
            }
            if (message.kind === 'opening' || message.kind === 'admission') {
              return (
                <li key={message.key} className={gap} data-speaker="character" data-testid={message.kind === 'admission' ? 'interrogation-admission' : undefined}>
                  <div className="flex items-end gap-2">
                    {avatar(lastOfGroup)}
                    <StaticBubble speakerName={speakerName} admission={message.kind === 'admission'}>
                      {message.text}
                    </StaticBubble>
                  </div>
                </li>
              );
            }
            const line = message.line;
            const lineId = line.id ?? message.key;
            const outcome = challengeOf(lineId);
            const isNoted = noted.includes(lineId);
            const open = selected === lineId;
            return (
              <li key={message.key} className={gap} data-speaker="character" data-line-id={lineId}>
                <div className="flex items-end gap-2">
                  {avatar(lastOfGroup)}
                  <div className="flex max-w-[85%] flex-col items-start gap-1.5">
                    <button
                      ref={(element) => {
                        lineRefs.current[lineId] = element;
                      }}
                      type="button"
                      data-testid="interrogation-line"
                      aria-expanded={open}
                      aria-keyshortcuts="N P"
                      onClick={() => setSelected(open ? null : lineId)}
                      onKeyDown={(event) => onLineKeyDown(event, line)}
                      className={`w-fit break-words rounded-card rounded-bl-md border px-3 py-2 text-left text-ink shadow-card ${FOCUS_RING} ${
                        open ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-paper'
                      } ${outcome && !outcome.correct ? 'opacity-80' : ''}`}
                    >
                      <span className="sr-only">{speakerName}: </span>
                      {line.text}
                      {(isNoted || outcome) && (
                        <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
                          {isNoted && <span className="rounded-full bg-highlight px-2 py-0.5 text-ink">W notatniku</span>}
                          {outcome?.correct && <span className="rounded-full bg-danger px-2 py-0.5 text-white">Sprzeczność obalona</span>}
                          {outcome && !outcome.correct && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Podważona - bez skutku</span>}
                        </span>
                      )}
                    </button>
                    {open && (
                      <div role="group" aria-label="Akcje kwestii" className="flex flex-wrap gap-2" data-testid="interrogation-actions">
                        {!isNoted && (
                          <button
                            type="button"
                            onClick={(event) => addFragment(line, event.currentTarget)}
                            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-accent/40 bg-accent-soft px-4 text-sm font-semibold text-accent-ink hover:bg-accent/15 ${FOCUS_RING}`}
                          >
                            <NotebookPen aria-hidden="true" className="h-4 w-4" />
                            Dodaj do notatek
                          </button>
                        )}
                        {!outcome && (
                          <button
                            type="button"
                            onClick={() => openPicker(lineId)}
                            disabled={pending}
                            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-danger/50 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60 ${FOCUS_RING}`}
                          >
                            <Gavel aria-hidden="true" className="h-4 w-4" />
                            Podważ
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div ref={footerRef} role="group" aria-label="Pytania i postęp przesłuchania" tabIndex={-1} className={`dialogue-footer mx-auto w-full max-w-[760px] shrink-0 pt-2 outline-none ${FOCUS_RING}`}>
        <p role="status" data-testid="interrogation-status" className="min-h-[1.25rem] text-sm text-ink">
          {status}
        </p>
        {hasNewMessages && (
          <button
            type="button"
            onClick={() => {
              logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
              stickToBottomRef.current = true;
              setHasNewMessages(false);
            }}
            className={`mb-2 min-h-[44px] rounded-full border border-accent/40 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent-ink ${FOCUS_RING}`}
          >
            ↓ Nowe wiadomości
          </button>
        )}
        {consoleAvailable && (
          <button
            ref={consoleButtonRef}
            type="button"
            data-testid="interrogation-console-open"
            onClick={() => setConsoleOpen(true)}
            className={`mb-2 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85 ${FOCUS_RING}`}
          >
            <Monitor aria-hidden="true" className="h-4 w-4" />
            Konsola{dossier.ready ? ' ✓' : ''}
          </button>
        )}
        {available.length > 0 && (
          <ul
            aria-label="Pytania do zadania"
            className="dialogue-chips flex max-h-[40cqh] flex-wrap gap-2 overflow-y-auto [@media(max-height:500px)]:flex-nowrap [@media(max-height:500px)]:overflow-x-auto [@media(max-height:500px)]:overflow-y-hidden [@media(max-height:500px)]:pb-1"
          >
            {available.map((question) => (
              <li key={question.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => ask(question.id)}
                  aria-disabled={typing}
                  className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-semibold ${FOCUS_RING} ${
                    typing ? 'cursor-default border-border bg-paper text-muted' : 'border-accent/40 bg-accent-soft text-accent-ink hover:bg-accent/15'
                  }`}
                >
                  {question.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="dialogue-progress mt-3 text-sm text-slate-600">
          {ready
            ? 'Przesłuchanie zakończone - „Dalej” w pasku.'
            : `Wymagane pytania: ${askedRequired}/${required.length}${consoleAvailable && !dossier.ready ? ' · konsola: zaznacz ślady włamania' : ''}`}
        </p>
      </div>

      {consoleOpen && consoleAvailable && (
        <div
          ref={consoleRef}
          role="dialog"
          aria-modal="true"
          aria-label="Konsola administratora"
          data-testid="interrogation-console"
          onKeyDown={trapTab}
          className="absolute inset-0 z-20 flex min-h-0 flex-col rounded-card border border-border bg-accent-soft p-3 sm:p-4"
        >
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <Monitor aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" />
            <h3 className="min-w-0 flex-1 truncate text-base font-bold text-ink">Konsola administratora</h3>
            <button
              type="button"
              data-console-close
              onClick={closeConsole}
              aria-label="Zamknij konsolę"
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink hover:bg-paper ${FOCUS_RING}`}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <DossierDocuments state={dossier} tabsLabel="Zakładki konsoli" hint="Zaznacz wpis, który świadczy o włamaniu." />
          <p className="mt-2 shrink-0 text-xs text-muted">
            {dossier.ready
              ? 'Konsola przejrzana.'
              : `Zakładki: ${dossier.opened.length} z ${documents.length}${dossier.requiredRows.length > 0 ? ` · ślady: ${dossier.requiredNoted} z ${dossier.requiredRows.length}` : ''}.`}
          </p>
        </div>
      )}

      {pickerFor && pickerLine && (
        <div
          ref={pickerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="interrogation-picker-title"
          data-testid="interrogation-picker"
          onKeyDown={trapTab}
          className="absolute inset-x-0 bottom-0 z-30 flex max-h-[85%] min-h-0 flex-col rounded-t-card border border-border bg-surface p-3 shadow-card sm:p-4"
        >
          <div className="mb-2 flex shrink-0 items-start gap-2">
            <h3 id="interrogation-picker-title" className="min-w-0 flex-1 text-base font-bold text-ink">
              Który dowód podważa: „{pickerLine.text}”?
            </h3>
            <button
              type="button"
              onClick={closePicker}
              aria-label="Anuluj podważenie"
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink hover:bg-paper ${FOCUS_RING}`}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <p className="mb-2 shrink-0 text-sm text-muted">Jedna próba na kwestię - pudło też się liczy.</p>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" aria-label="Dowody z notatnika">
            {evidenceNotes.map((note) => (
              <li key={note.ref}>
                <button
                  type="button"
                  data-testid="interrogation-evidence"
                  disabled={pending}
                  onClick={() => challenge(pickerFor, note)}
                  className={`flex min-h-[44px] w-full items-start gap-2 rounded-btn border border-border bg-paper px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft disabled:opacity-60 ${FOCUS_RING}`}
                >
                  <span className="mt-0.5 shrink-0 text-amber-800">
                    <NoteKindIcon kind={note.kind} />
                  </span>
                  <span>{note.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Dymek postaci bez akcji (otwarcie, przyznanie po trafionym podważeniu - wyróżnione).
function StaticBubble({ speakerName, admission, children }: { speakerName: string; admission: boolean; children: ReactNode }) {
  return (
    <p
      className={`w-fit max-w-[85%] break-words rounded-card rounded-bl-md border px-3 py-2 text-ink shadow-card ${
        admission ? 'border-danger bg-danger/10 font-semibold' : 'border-border bg-surface'
      }`}
    >
      <span className="sr-only">
        {speakerName}
        {admission ? ' (przyznaje)' : ''}:{' '}
      </span>
      {children}
    </p>
  );
}

/**
 * Wynik przesłuchania (po zapisie i w podglądzie „Wstecz”): trafione podważenia, pudła i rozstrzygnięcie - które kwestie kłamały i jak
 * postać się przyznała (detail z serwera, dopiero po ukończeniu bloku).
 */
export function InterrogationResult({ block, detail, challenges, points }: { block: ContentBlock; detail?: ResultDetail; challenges?: InterrogationChallenge[]; points?: number }) {
  const lines = (block.questions ?? []).flatMap((question) => question.lines ?? []);
  const textOf = (lineId: string) => lines.find((line) => line.id === lineId)?.text ?? '';
  const contradictions = detail?.contradictions ?? [];
  const hits = (challenges ?? []).filter((challenge) => challenge.correct).length;
  const misses = (challenges ?? []).length - hits;
  return (
    <div data-testid="interrogation-result" className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
      <h3 className="text-lg font-bold text-ink">{block.title ?? 'Przesłuchanie'}</h3>
      {contradictions.length === 0 ? (
        <p className="text-ink">
          To zeznanie było prawdziwe - nie każdy świadek kłamie.
          {misses > 0 ? ` Podważone bez skutku: ${misses}.` : ''}
        </p>
      ) : (
        <>
          <p className="text-ink">
            Obalone sprzeczności: {hits} z {contradictions.length}
            {misses > 0 ? ` · pudła: ${misses}` : ''}
            {points !== undefined ? ` · wynik ${Math.round(points * 100)}%` : ''}.
          </p>
          <ul className="space-y-2">
            {contradictions.map((contradiction) => {
              const hit = (challenges ?? []).some((challenge) => challenge.lineId === contradiction.lineId && challenge.correct);
              return (
                <li key={contradiction.lineId} className="rounded-card border border-border bg-surface p-3 shadow-card">
                  <p className="flex items-start gap-2 text-sm text-muted">
                    {hit ? <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <X aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
                    <span>
                      <span className="sr-only">{hit ? 'Obalone: ' : 'Nieobalone: '}</span>„{textOf(contradiction.lineId)}”
                    </span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">{contradiction.line.text}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
