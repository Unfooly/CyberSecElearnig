'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useSfx } from '@/lib/sfx';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { DEFAULT_HINT, useCompleteHint, useHints } from '../player/hints';
import Hint from '../player/Hint';
import ExploreFooter from './ExploreFooter';

// Odległość od dołu wątku (px), poniżej której uznajemy usera za "trzymającego się dołu" - autoprzewijanie po
// nowej wiadomości działa; powyżej tego progu user CZYTA historię, więc nie szarpiemy go w dół (fix/dialogue-sticky-questions).
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
// "Pisanie" rozmówcy (feat/dialogue-chat, D-087): czas zależny od długości kwestii, w granicach; przy reduced-motion stałe 300 ms.
const TYPING_BASE_MS = 500;
const TYPING_PER_CHAR_MS = 18;
const TYPING_MIN_MS = 700;
const TYPING_MAX_MS = 2200;
const TYPING_REDUCED_MS = 300;

/** Czas wskaźnika pisania przed kwestią: clamp(500 + 18 ms × znaki, 700, 2200) ms. */
export function typingDelayMs(text: string, reducedMotion = false): number {
  if (reducedMotion) return TYPING_REDUCED_MS;
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, TYPING_BASE_MS + TYPING_PER_CHAR_MS * text.length));
}

type Speaker = 'character' | 'player';
type Message = { key: string; speaker: Speaker; text: string; typing?: boolean };

function reducedMotionNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

// Dymek rozmówcy (lewa strona): avatar tylko przy OSTATNIEJ wiadomości grupy (kolejne wiadomości tej samej osoby) - w jego miejscu
// przy wcześniejszych ta sama pusta rezerwacja (dymki wyrównane). Na poziomie modułu (stała tożsamość komponentu między renderami).
function CharacterBubble({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  speakerName,
  showAvatar,
  children,
}: {
  avatarUrl: string | null;
  avatarFailed: boolean;
  onAvatarError: () => void;
  speakerName: string;
  showAvatar: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end gap-2">
      {showAvatar && avatarUrl && !avatarFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" onError={onAvatarError} />
      ) : (
        <span aria-hidden="true" className="h-8 w-8 shrink-0" />
      )}
      <p className="w-fit max-w-[75%] break-words rounded-card rounded-bl-md border border-border bg-surface px-3 py-2 text-ink shadow-card">
        <span className="sr-only">{speakerName}: </span>
        {children}
      </p>
    </div>
  );
}

// Dymek gracza (prawa strona, akcent) z jego avatarem przy ostatniej wiadomości grupy.
export function PlayerBubble({ avatarUrl, initials, showAvatar, children }: { avatarUrl: string | null; initials?: string; showAvatar: boolean; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <p className="ml-auto w-fit max-w-[75%] break-words rounded-card rounded-br-md bg-accent px-3 py-2 text-white">
        <span className="sr-only">Ty: </span>
        {children}
      </p>
      <span aria-hidden="true" className="h-8 w-8 shrink-0">
        {showAvatar && <AvatarDisplay avatarUrl={avatarUrl} size="sm" initials={initials} />}
      </span>
    </div>
  );
}

// Wskaźnik pisania rozmówcy: trzy animowane kropki z jego avatarem (reduced-motion: statyczne „pisze…”). Dla czytnika ukryty - wątek
// jest regionem live i ogłasza gotową wiadomość; klik (albo Spacja w bloku) pokazuje wiadomość od razu. Także przesłuchanie (D-118).
export function TypingBubble({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  reducedMotion,
  onSkip,
}: {
  avatarUrl: string | null;
  avatarFailed: boolean;
  onAvatarError: () => void;
  reducedMotion: boolean;
  onSkip: () => void;
}) {
  return (
    <div aria-hidden="true" data-testid="dialogue-typing" onClick={onSkip} className="flex cursor-pointer items-end gap-2">
      {avatarUrl && !avatarFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- jak wyżej
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border" onError={onAvatarError} />
      ) : (
        <span className="h-8 w-8 shrink-0" />
      )}
      <span className="flex h-9 items-center gap-1 rounded-card rounded-bl-md border border-border bg-surface px-3 text-sm text-muted shadow-card">
        {reducedMotion ? (
          'pisze…'
        ) : (
          <>
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </>
        )}
      </span>
    </div>
  );
}

// Rozmowa z postacią jak w komunikatorze (feat/dialogue-chat, D-087). Gracz wybiera pytanie z chipów pod wątkiem: jego dymek pojawia się
// od razu (dźwięk msg-send), potem rozmówca „pisze” (wskaźnik z kropkami, typingDelayMs) i przychodzi jego wiadomość (msg-receive) -
// każda kwestia z własnym „pisaniem”, tak samo kwestia otwierająca. Klik we wskaźnik albo Spacja = wiadomość od razu. Gdy rozmówca
// pisze, chipy są nieaktywne. Pytanie liczy się jako zadane po ostatniej kwestii; dopiero wtedy notatka do notatnika (dowód, gdy
// `evidence`). Wiadomości tej samej osoby są grupowane (6 px odstępu, avatar przy ostatniej), między osobami 12 px; kolumna wątku max
// 760 px, wyśrodkowana. Podgląd ukończonego bloku: bez opóźnień i dźwięków. Odpowiedź dla serwera: { asked: [id...] } w kolejności
// ukończenia.
//
// Układ (fix/dialogue-sticky-questions): korzeń flex-1 flex-col, WĄTEK (`role="log"`, aria-live) jest jedynym przewijanym elementem,
// stopka z chipami zostaje poza obszarem przewijania. `relative` na wątku: sr-only spany dymków (position:absolute) muszą mieć
// containing block w nim, inaczej nadymały scrollHeight obszaru bloku (layout-check).
export default function DialogueBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  review = false,
  myAvatarUrl = null,
  myInitials,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { asked: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane pytania zadane) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
  /** Avatar gracza (dymki po prawej) - z useMyAvatar w CoursePlayer.tsx, pobrany RAZ na wejście do kursu. */
  myAvatarUrl?: string | null;
  myInitials?: string;
}) {
  const questions = block.questions ?? [];
  const character = block.character;
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const hints = useHints();
  const reducedMotion = usePrefersReducedMotion();
  const play = useSfx(['msg-send', 'msg-receive']);
  // Podpowiedź (D-093, dawniej Fooli) jako pasek NAD nagłówkiem rozmowy (fix/dialogue-polish); w podglądzie "Wstecz" nie (wspólny
  // HintProvider). Z treści: `tip` (D-096), dla starszych wersji `mascot.text` (poza przestarzała).
  const bannerHint = hints.hint ?? block.tip ?? block.mascot?.text ?? DEFAULT_HINT.DIALOGUE;
  // Kwestia otwierająca: w podglądzie od razu, w żywym bloku też „pisana”.
  const [openingShown, setOpeningShown] = useState(review || !character?.opening);
  // Postęp rozmowy: ile kwestii każdego pytania już przyszło (kolejność = kolejność wyboru).
  const [progress, setProgress] = useState<{ id: string; shown: number }[]>([]);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Stopka - zawsze w DOM: stabilny cel fokusu, gdy kliknięty chip znika albo nie zostały już żadne pytania.
  const footerRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const avatarUrl = contentAssetUrl(contentBase, character?.avatar, 'image');

  const linesOf = (id: string): string[] => {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question) return [];
    if (question.lines && question.lines.length > 0) return question.lines.map((line) => line.text);
    return question.answer ? [question.answer] : [];
  };
  const isComplete = (entry: { id: string; shown: number }) => entry.shown >= linesOf(entry.id).length;
  const asked = progress.filter(isComplete).map((entry) => entry.id);
  const current = progress.find((entry) => !isComplete(entry)) ?? null;
  // Następna wiadomość rozmówcy, która właśnie się „pisze” (null = nikt nie pisze).
  const pendingText = !openingShown ? (character?.opening ?? null) : current ? (linesOf(current.id)[current.shown] ?? null) : null;
  const typing = pendingText !== null;
  const pendingKey = !openingShown ? 'opening' : current ? `${current.id}#${current.shown}` : '';

  const required = requiredItemIds(questions, block.requiredQuestions);
  const doneCount = required.filter((id) => asked.includes(id)).length;
  const ready = doneCount >= required.length;
  useCompleteHint(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ asked }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku, nie "stabilność".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, review]);

  // Wiadomości wątku w kolejności (z grupowaniem liczonym niżej).
  const messages: Message[] = [];
  if (character?.opening && openingShown) messages.push({ key: 'opening', speaker: 'character', text: character.opening });
  for (const entry of progress) {
    const question = questions.find((candidate) => candidate.id === entry.id);
    if (!question) continue;
    messages.push({ key: `${entry.id}-q`, speaker: 'player', text: question.text });
    linesOf(entry.id)
      .slice(0, entry.shown)
      .forEach((line, index) => messages.push({ key: `${entry.id}-${index}`, speaker: 'character', text: line }));
  }
  if (typing && !review) messages.push({ key: `typing-${pendingKey}`, speaker: 'character', text: '', typing: true });
  // Klucz ostatniej wiadomości: zmienia się także wtedy, gdy wskaźnik pisania zamienia się w gotową kwestię (długość listy ta sama).
  const lastMessageKey = messages[messages.length - 1]?.key ?? '';
  // Wiadomość, która się właśnie "pisze" - reveal() działa tylko dla niej (stary timer po skipie nie dubluje kwestii ani notatki).
  const pendingKeyRef = useRef(pendingKey);
  pendingKeyRef.current = pendingKey;
  // Spacja pokazała kwestię: aktywacja przycisku na keyup (chip, który właśnie dostał fokus) nie może zadać kolejnego pytania.
  const swallowSpaceKeyUp = useRef(false);

  // „Pisanie”: po typingDelayMs pokazuje następną wiadomość rozmówcy (każda kwestia osobno). Podgląd - bez opóźnień.
  useEffect(() => {
    if (!typing) return undefined;
    if (review) {
      reveal(false, pendingKey);
      return undefined;
    }
    const timer = window.setTimeout(() => reveal(true, pendingKey), typingDelayMs(pendingText ?? '', reducedMotion || reducedMotionNow()));
    return () => window.clearTimeout(timer);
    // reveal/pendingText wynikają z pendingKey - nowy klucz = nowy timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, review]);

  // Autoprzewijanie do najnowszej wiadomości, gdy user był "przy dole" (inaczej przycisk "Nowe wiadomości").
  useEffect(() => {
    const log = logRef.current;
    if (!log || messages.length === 0) return;
    if (stickToBottomRef.current) {
      log.scrollTo({ top: log.scrollHeight, behavior: reducedMotionNow() ? 'auto' : 'smooth' });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageKey, messages.length]);

  // Tylko zdarzenie, w którym scrollTop ZMALAŁ, jest prawdziwym "user przewinął w górę" (animacja `smooth` odpala scroll na każdej
  // klatce - kod review fix/dialogue-sticky-questions); 1 px tolerancji na ułamkowy scrollTop.
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

  function scrollToLatest() {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: reducedMotionNow() ? 'auto' : 'smooth' });
    stickToBottomRef.current = true;
    setHasNewMessages(false);
  }

  // Fokus po zakończeniu pytania: na pierwszym pozostałym chipie, inaczej na stopce (bez przycisku "Zakończ rozmowę"). Kwestia przychodzi
  // po opóźnieniu - fokus przenosimy tylko, gdy wciąż jest w bloku (stopka po kliknięciu chipa); gdy gracz w międzyczasie przeszedł
  // Tabem gdzie indziej (notatnik, pasek), nie zabieramy mu go.
  function focusFooterAfterQuestionEnds() {
    const active = document.activeElement;
    if (active && active !== document.body && !rootRef.current?.contains(active)) return;
    const nextChip = chipsRef.current?.querySelector<HTMLButtonElement>('button');
    if (nextChip) nextChip.focus();
    else footerRef.current?.focus();
  }

  function finish(id: string) {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question?.note || review || !block.id) return;
    addNote({ blockId: block.id, text: question.note.text, kind: question.note.kind });
    if (question.evidence) {
      evidence.addPending(`${block.id}.${id}`);
      hints.notify('evidence');
    }
  }

  // Pokazuje wiadomość, która się „pisała” (koniec opóźnienia albo klik/Spacja) - tylko jeśli to wciąż ta sama wiadomość.
  function reveal(withSound: boolean, forKey: string = pendingKeyRef.current) {
    if (!forKey || forKey !== pendingKeyRef.current) return;
    pendingKeyRef.current = '';
    if (!openingShown) {
      setOpeningShown(true);
      if (withSound) play('msg-receive');
      return;
    }
    if (!current) return;
    const shown = current.shown + 1;
    setProgress((list) => list.map((entry) => (entry.id === current.id ? { ...entry, shown } : entry)));
    if (withSound) play('msg-receive');
    if (shown >= linesOf(current.id).length) {
      finish(current.id);
      if (!review) window.setTimeout(focusFooterAfterQuestionEnds, 0);
    }
  }

  function ask(id: string) {
    if (typing || swallowSpaceKeyUp.current || progress.some((entry) => entry.id === id)) return;
    setProgress((list) => [...list, { id, shown: 0 }]);
    if (!review) {
      play('msg-send');
      // Kliknięty chip znika z listy od razu - fokus na stopkę, żeby klawiatura/czytnik go nie zgubiły.
      footerRef.current?.focus();
    }
  }

  function skipOnSpace(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' || review) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (event.repeat) {
      // Przytrzymana Spacja po pokazaniu kwestii nie klika pytań; poza tym (np. fokus na wątku) przewija jak zwykle.
      if (typing || swallowSpaceKeyUp.current) event.preventDefault();
      return;
    }
    if (!typing) return;
    event.preventDefault();
    swallowSpaceKeyUp.current = true;
    // Bezpiecznik: keyup mógł trafić poza blok (fokus przeniesiony) - blokada nie może zostać na stałe.
    window.setTimeout(() => {
      swallowSpaceKeyUp.current = false;
    }, 600);
    reveal(true);
  }

  function releaseSpace(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' || !swallowSpaceKeyUp.current) return;
    // Keyup tej samej Spacji aktywowałby przycisk z fokusem (chip po ostatniej kwestii) - blokujemy tę jedną aktywację.
    event.preventDefault();
    swallowSpaceKeyUp.current = false;
  }

  const availableQuestions = questions.filter((question) => !progress.some((entry) => entry.id === question.id));
  const speakerName = character?.name ?? 'Postać';
  const onAvatarError = () => setAvatarFailed(true);

  return (
    // flex-1 (nie h-full) i [container-type:size]: chipy niżej używają cqh (max-h-[40cqh]) względem TEGO korzenia.
    <div ref={rootRef} onKeyDown={skipOnSpace} onKeyUp={releaseSpace} className="flex min-h-0 w-full flex-1 flex-col [container-type:size]">
      {!review && <Hint variant="bar" text={bannerHint} />}
      {block.prompt && <p className="mx-auto mb-3 w-full max-w-[760px] shrink-0 text-lg text-ink">{block.prompt}</p>}
      {/* Niska wysokość (telefon w poziomie): nagłówek rozmowy znika (imię i avatar są przy wiadomościach), chipy w jednym przewijanym
          rzędzie - inaczej wątek kurczył się do kilkunastu pikseli (layout-check, 844x390). */}
      {character && (
        <div className="mx-auto mb-3 flex w-full max-w-[760px] shrink-0 items-center gap-3 [@media(max-height:500px)]:hidden">
          {avatarUrl && !avatarFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
            <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" onError={() => setAvatarFailed(true)} />
          )}
          <p className="text-sm text-muted">
            Rozmawiasz z: <span className="font-semibold text-ink">{character.name}</span>
            {character.role && <span>, {character.role}</span>}
          </p>
        </div>
      )}

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Historia rozmowy"
        data-typing={typing && !review ? 'true' : 'false'}
        tabIndex={0}
        onScroll={handleScroll}
        className={`relative min-h-0 flex-1 overflow-y-auto outline-none ${FOCUS_RING}`}
      >
        <ol data-testid="dialogue-thread" className="mx-auto w-full max-w-[760px] pb-1">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            // 6 px w obrębie osoby, 12 px między osobami; avatar przy ostatniej wiadomości grupy.
            const gap = !previous ? '' : previous.speaker === message.speaker ? 'mt-1.5' : 'mt-3';
            const lastOfGroup = !next || next.speaker !== message.speaker;
            return (
              <li key={message.key} data-speaker={message.speaker} className={gap}>
                {message.typing ? (
                  <TypingBubble avatarUrl={avatarUrl} avatarFailed={avatarFailed} onAvatarError={onAvatarError} reducedMotion={reducedMotion} onSkip={() => reveal(true)} />
                ) : message.speaker === 'player' ? (
                  <PlayerBubble avatarUrl={myAvatarUrl} initials={myInitials} showAvatar={lastOfGroup}>
                    {message.text}
                  </PlayerBubble>
                ) : (
                  <CharacterBubble avatarUrl={avatarUrl} avatarFailed={avatarFailed} onAvatarError={onAvatarError} speakerName={speakerName} showAvatar={lastOfGroup}>
                    {message.text}
                  </CharacterBubble>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Stopka poza obszarem przewijania: "Nowe wiadomości", chipy pytań (własny scroll, gdy dużo), postęp. Na scenie węższej niż 640 px
          (fix/mobile-player-bar, globals.css .dialogue-footer): chipy w jednym poziomym rzędzie, postęp jedną linijką nad nimi. */}
      <div ref={footerRef} role="group" aria-label="Pytania i postęp rozmowy" tabIndex={-1} className={`dialogue-footer mx-auto w-full max-w-[760px] shrink-0 pt-2 outline-none ${FOCUS_RING}`}>
        {hasNewMessages && (
          <button
            type="button"
            onClick={scrollToLatest}
            className={`dialogue-new mb-3 min-h-[44px] rounded-full border border-accent/40 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent/15 ${FOCUS_RING}`}
          >
            ↓ Nowe wiadomości
          </button>
        )}

        {availableQuestions.length > 0 && (
          <ul
            ref={chipsRef}
            aria-label="Pytania do zadania"
            className="dialogue-chips flex max-h-[40cqh] flex-wrap gap-2 overflow-y-auto [@media(max-height:500px)]:flex-nowrap [@media(max-height:500px)]:overflow-x-auto [@media(max-height:500px)]:overflow-y-hidden [@media(max-height:500px)]:pb-1"
          >
            {availableQuestions.map((question) => (
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

        {/* dialogue-progress (globals.css): na wąskiej scenie jedna linijka NAD chipami. */}
        <ExploreFooter
          done={doneCount}
          total={required.length}
          noun="pytań"
          verb="Zadano"
          readyText="Wszystkie wymagane pytania zadane."
          review={review}
          className={`dialogue-progress mt-4 ${review ? 'dialogue-progress-review text-xs text-slate-500' : 'text-sm text-slate-600'}`}
        />
      </div>
    </div>
  );
}
