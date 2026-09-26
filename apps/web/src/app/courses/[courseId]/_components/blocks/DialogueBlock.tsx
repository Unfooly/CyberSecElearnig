'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import ExploreFooter from './ExploreFooter';

// Odległość od dołu wątku (px), poniżej której uznajemy usera za "trzymającego się dołu" - autoprzewijanie po
// nowej wiadomości działa; powyżej tego progu user CZYTA historię, więc nie szarpiemy go w dół (fix/dialogue-sticky-questions).
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;

// Kwestia postaci: avatar PRZY KAŻDEJ wiadomości (nie tylko w nagłówku) - jak w prawdziwym komunikatorze. Na poziomie
// MODUŁU (nie wewnątrz DialogueBlock): zdefiniowany w ciele komponentu dostawałby nową tożsamość przy KAŻDYM renderze
// rodzica, więc React odmontowywałby i montował na nowo WSZYSTKIE dymki wątku przy każdej zmianie stanu (progress,
// avatarFailed), nie tylko nowy - zbędna praca uzgadniania.
function CharacterBubble({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  speakerName,
  children,
}: {
  avatarUrl: string | null;
  avatarFailed: boolean;
  onAvatarError: () => void;
  speakerName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end gap-2">
      {avatarUrl && !avatarFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src)
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          onError={onAvatarError}
        />
      ) : (
        <span aria-hidden="true" className="h-8 w-8 shrink-0" />
      )}
      <p className="max-w-[75%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
        <span className="sr-only">{speakerName}: </span>
        {children}
      </p>
    </div>
  );
}

// Rozmowa z postacią w stylu komunikatora: kwestie postaci Z LEWEJ z jej avatarem PRZY KAŻDEJ kwestii (nie tylko w nagłówku), pytania
// gracza Z PRAWEJ w kolorze akcentu bez avatara (jak "Ty" w czacie). Gracz wybiera pytanie z listy "chipów" pod rozmową; zadane pytanie
// znika z listy chipów (zostaje widoczne w wątku rozmowy). Postać odpowiada KWESTIAMI PO KOLEI (klik "Następna kwestia" w dymku, nie cały
// tekst naraz; odpowiedź bez `lines` to jedna kwestia). Pytanie liczy się jako zadane, gdy wszystkie kwestie zostały wypowiedziane;
// dopiero wtedy pytanie z notatką dopisuje wpis do notatnika (dowód, gdy `evidence`). Podczas rozmowy pozostałe pytania są nieaktywne.
// Notatki dopisywane są tylko poza podglądem (serwer i tak sam wylicza je przy zapisie bloku). Avatar postaci tylko przez <img> z bazy
// zasobów. Odpowiedź dla serwera: { asked: [id...] } w kolejności ukończenia.
//
// Układ komunikatora (fix/dialogue-sticky-questions): korzeń h-full flex-col (PlayerStage.tsx, contentLayout='fill'
// - ten sam CSS co scena SCENE_HOTSPOTS, patrz komentarz tam) - nagłówek/prompt shrink-0, WĄTEK (<ol>) jest
// JEDYNYM elementem, który się przewija (flex-1 min-h-0 overflow-y-auto), stopka (przycisk "Następna kwestia",
// "Nowe wiadomości", chipy pytań, ExploreFooter) zostaje POZA obszarem przewijania - user nie musi już przewijać
// CAŁEGO bloku, żeby zobaczyć/kliknąć kolejne pytanie.
export default function DialogueBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { asked: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane pytania zadane) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const questions = block.questions ?? [];
  const character = block.character;
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const mascot = useMascotReaction();
  // Postęp rozmowy: ile kwestii każdego pytania już padło (kolejność = kolejność wyboru).
  const [progress, setProgress] = useState<{ id: string; shown: number }[]>([]);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // Nowe wiadomości doszły, gdy user NIE był "przy dole" wątku (patrz stickToBottomRef) - przycisk "Nowe wiadomości"
  // zamiast szarpania scrolla.
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  // Stopka (przycisk "Następna kwestia"/"Nowe wiadomości"/chipy/ExploreFooter) - ZAWSZE w DOM (w przeciwieństwie do
  // samych chipów, renderowanych warunkowo), żeby mieć stabilny cel fokusu nawet gdy nie zostały już żadne pytania.
  const footerRef = useRef<HTMLDivElement>(null);
  // Domyślnie true (świeżo otwarty blok jest "na dole" - jeszcze nic nie ma do przewinięcia) - aktualizowane w
  // handleScroll, czytane w efekcie autoprzewijania. Ref (nie state): odczyt/zapis w handlerach zdarzeń i efekcie,
  // bez potrzeby wywoływania re-renderu przy każdym scrollu.
  const stickToBottomRef = useRef(true);
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
  // Liczba aktualnie POKAZANYCH wiadomości (opening + pytanie gracza + każda odsłonięta kwestia postaci) - deps
  // efektu autoprzewijania niżej: rośnie o 1 przy KAŻDYM kliknięciu (ask/next), niezależnie od tego, czy to
  // pytanie/kwestia kończy całe pytanie.
  const messageCount = (character?.opening ? 1 : 0) + progress.reduce((sum, entry) => sum + 1 + entry.shown, 0);

  const required = requiredItemIds(questions, block.requiredQuestions);
  const doneCount = required.filter((id) => asked.includes(id)).length;
  const ready = doneCount >= required.length;
  useCompleteReaction(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ asked }) : null);
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, review]);

  // Autoprzewijanie do najnowszej wiadomości (fix/dialogue-sticky-questions) - WYŁĄCZNIE gdy user był "przy dole"
  // (stickToBottomRef, aktualizowane w handleScroll) w chwili dojścia nowej wiadomości; w przeciwnym razie pokazuje
  // przycisk "Nowe wiadomości" zamiast szarpać scrollem czytającego historię usera. prefers-reduced-motion
  // sprawdzane W MOMENCIE akcji (nie subskrypcja) - ten sam wzorzec co RewardCard.tsx (D-076).
  useEffect(() => {
    const log = logRef.current;
    if (!log || messageCount === 0) return;
    if (stickToBottomRef.current) {
      const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageCount]);

  function handleScroll() {
    const log = logRef.current;
    if (!log) return;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    if (atBottom) setHasNewMessages(false);
  }

  function scrollToLatest() {
    const log = logRef.current;
    if (!log) return;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    stickToBottomRef.current = true;
    setHasNewMessages(false);
  }

  // Fokus po zakończeniu pytania (ask()/next() niżej): na PIERWSZYM pozostałym chipie, gdy jakieś zostały (naturalne
  // "co dalej" - skupialny mimo aria-disabled, bo to nie prawdziwy atrybut disabled), inaczej na kontenerze stopki
  // (footerRef - "bezpieczny" cel, żeby czytnik ekranu/klawiatura nie zgubiły fokusu, ten sam powód co dawne
  // logRef.current.focus(), ale TERAZ w stopce, nie w wątku - ustalone z właścicielem produktu: bez nowego
  // przycisku "Zakończ rozmowę", kończenie zostaje wyłącznie przez zewnętrzne "Dalej" paska powłoki).
  function focusFooterAfterQuestionEnds() {
    const nextChip = footerRef.current?.querySelector<HTMLButtonElement>('ul[aria-label="Pytania do zadania"] button');
    if (nextChip) nextChip.focus();
    else footerRef.current?.focus();
  }

  function finish(id: string) {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question?.note || review || !block.id) return;
    addNote({ blockId: block.id, text: question.note.text, kind: question.note.kind });
    if (question.evidence) {
      evidence.addPending(`${block.id}.${id}`);
      mascot.react('evidence');
    }
  }

  function ask(id: string) {
    if (current || progress.some((entry) => entry.id === id)) return;
    setProgress((list) => [...list, { id, shown: 1 }]);
    if (linesOf(id).length <= 1) {
      finish(id);
      // Pytanie JEDNOKWESTYJNE kończy się od razu w TYM kliknięciu: jego chip znika z listy w tym samym renderze, co
      // klikany przycisk - bez przeniesienia fokusu klawiatura/czytnik ekranu zgubiłby fokus (ląduje na <body>), tak
      // samo jak przy ostatniej kwestii pytania wielokwestyjnego (patrz next() niżej - ten sam fix, ten sam powód).
      if (!review) setTimeout(focusFooterAfterQuestionEnds, 0);
    }
  }

  function next() {
    if (!current) return;
    const shown = current.shown + 1;
    setProgress((list) => list.map((entry) => (entry.id === current.id ? { ...entry, shown } : entry)));
    if (shown >= linesOf(current.id).length) {
      finish(current.id);
      // Przycisk "Następna kwestia" znika po ostatniej kwestii: fokus na stopkę, żeby klawiatura nie wracała na początek strony.
      if (!review) setTimeout(focusFooterAfterQuestionEnds, 0);
    }
  }

  const availableQuestions = questions.filter((question) => !asked.includes(question.id));
  const speakerName = character?.name ?? 'Postać';
  const onAvatarError = () => setAvatarFailed(true);

  return (
    // flex-1 (NIE h-full - kod review/layout-check.mjs, realny bug: percentage height "rozwiązuje się" tylko
    // względem PRZODKA o DEFINITYWNEJ wysokości; ten korzeń jest zwykłym flex itemem bez własnego flex-grow, więc
    // h-full ("100%") potrafi się cicho policzyć jako "auto" gdzieś w łańcuchu i cała treść (wątek + stopka)
    // rośnie do wysokości TREŚCI zamiast do dostępnego miejsca - wątek wtedy nigdy nie dostaje overflow, a obszar
    // bloku w PlayerStage.tsx zaczyna się przewijać, dokładnie to, co ten branch miał naprawić, złapane przez
    // scripts/layout-check.mjs: checkMainSceneFits po wygenerowaniu >=8 wiadomości). `flex-1` (flex-basis:0% +
    // flex-grow:1) NIE polega na procentach - dostaje CAŁĄ dostępną przestrzeń przez algorytm flex, ten sam
    // sprawdzony wzorzec co korzeń SceneHotspotsBlock.tsx (`flex min-h-0 w-full flex-1 flex-col`).
    // [container-type:size] - flex-1 DAJE mu definitywny rozmiar w obu osiach (bez okrężnej zależności - w
    // przeciwieństwie do karty hotspotu z height:auto, patrz globals.css), więc wystarczy, żeby chipy pytań niżej
    // mogły użyć jednostek cqh (max-h-[40cqh]) - zwykłe "%" NIC by nie dało: ich BEZPOŚREDNI rodzic (stopka,
    // shrink-0) nie ma definitywnej wysokości (sizuje się do treści), a procentowa max-height względem rodzica bez
    // definitywnej wysokości liczy się jako "none" (bez efektu) per spec CSS - cqh celuje w NAJBLIŻSZEGO PRZODKA
    // z container-type, czyli w TEN korzeń, pomijając stopkę po drodze.
    <div className="flex min-h-0 w-full flex-1 flex-col [container-type:size]">
      {block.prompt && <p className="mb-3 shrink-0 text-lg text-slate-900">{block.prompt}</p>}
      {character && (
        <div className="mb-3 flex shrink-0 items-center gap-3">
          {avatarUrl && !avatarFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
            <img
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
              onError={() => setAvatarFailed(true)}
            />
          )}
          <p className="text-sm text-slate-600">
            Rozmawiasz z: <span className="font-semibold text-slate-900">{character.name}</span>
            {character.role && <span>, {character.role}</span>}
          </p>
        </div>
      )}

      {/* Wątek: JEDYNY przewijany element bloku (fix/dialogue-sticky-questions) - role="log"/aria-live (nowe
          wiadomości ogłaszane czytnikowi ekranu), tabIndex=0 (nie -1: ma być osiągalny Tab-em i przewijalny
          klawiaturą/strzałkami/PageDown, nie tylko celem programowego .focus()).
          `relative` (kod review/layout-check.mjs - realny, subtelny bug): `<span className="sr-only">` wewnątrz
          każdego dymku (CharacterBubble, "Ty: ") to Tailwind `position:absolute` BEZ ustawionych
          top/left/right/bottom - bez top/left przeglądarka liczy jego pozycję jako "statyczną" (tam, gdzie
          wylądowałby, gdyby był position:static), ale będąc position:absolute jest WYJĘTY z normalnego przepływu i
          szuka NAJBLIŻSZEGO PRZODKA Z WŁASNYM position (nie static) jako "containing block". Bez `relative` TUTAJ
          tym przodkiem było content-area w PlayerStage.tsx (position:relative, kilka poziomów wyżej) - sr-only
          spany z KAŻDEJ wiadomości (nawet dawno przewiniętej poza widoczny obszar tego <ol>) ROSŁY w nieskończoność
          w dół (każda kolejna wiadomość przesuwa ich "statyczną" pozycję), NIE PRZYCINANE przez `overflow-y-auto`
          TEGO <ol> (bo ich containing block leżał POZA nim) - to WŁAŚNIE one nadymały scrollHeight obszaru bloku w
          PlayerStage.tsx (checkMainSceneFits w scripts/layout-check.mjs łapał to po wygenerowaniu >=8 wiadomości:
          obszar bloku zaczynał się przewijać, dokładnie to, co ten branch ma naprawić). Ten sam bug był DROBNY
          i niewidoczny w starym layoucie (`contentLayout='slide'`) - CAŁY panel i tak się przewijał, więc "wyciek"
          poza ten konkretny <ol> nie miał znaczenia; ujawnił się dopiero z wewnętrznym scrollem. `relative` na TYM
          <ol> czyni go containing blockiem dla WŁASNYCH potomków position:absolute - sr-only spany zostają
          poprawnie przycięte razem z resztą wątku. */}
      <ol
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Historia rozmowy"
        tabIndex={0}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 space-y-3 overflow-y-auto focus:outline-none"
      >
        {character?.opening && (
          <li>
            <CharacterBubble avatarUrl={avatarUrl} avatarFailed={avatarFailed} onAvatarError={onAvatarError} speakerName={speakerName}>
              {character.opening}
            </CharacterBubble>
          </li>
        )}
        {progress.map((entry) => {
          const question = questions.find((candidate) => candidate.id === entry.id);
          if (!question) return null;
          const lines = linesOf(entry.id).slice(0, entry.shown);
          return (
            <li key={entry.id} className="space-y-2">
              <p className="ml-auto max-w-[75%] rounded-lg bg-indigo-600 px-3 py-2 text-white">
                <span className="sr-only">Ty: </span>
                {question.text}
              </p>
              {lines.map((line, index) => (
                <CharacterBubble key={index} avatarUrl={avatarUrl} avatarFailed={avatarFailed} onAvatarError={onAvatarError} speakerName={speakerName}>
                  {line}
                </CharacterBubble>
              ))}
            </li>
          );
        })}
      </ol>

      {/* Stopka (poza obszarem przewijania - zawsze widoczna, jak lista akcji w komunikatorze): "Następna kwestia",
          "Nowe wiadomości" (gdy user czyta historię i doszła nowa), chipy pytań (max-h-[40%] - własny scroll, gdy
          jest ich dużo, na WSZYSTKICH breakpointach), ExploreFooter. tabIndex=-1 na kontenerze - cel fokusu, gdy po
          ostatnim pytaniu nie zostały żadne chipy (focusFooterAfterQuestionEnds wyżej).
          pl-24 sm:pl-28 (kod review/layout-check.mjs - realna kolizja, nie estetyka): MascotOverlay.tsx renderuje
          ikonkę Fooli jako PRAWDZIWY, klikalny <button> (pointer-events-auto) w LEWYM DOLNYM rogu OBSZARU BLOKU
          (position:absolute, bottom-3 left-3, 76px/96px, z-10, ponad treścią bloku niezależnie od jej DOM-u) -
          ikonka jest tam PRZEZ CAŁY czas trwania bloku eksploracyjnego (DEFAULT_IDLE daje pozę nawet bez własnej
          reakcji treści), nie tylko chwilowo. Zanim stopka była przyklejona do dołu (ten branch), pierwszy chip
          mógł wylądować DOKŁADNIE pod nią i łapać jej kliknięcia zamiast pytania (złapane przez
          scripts/layout-check.mjs: locator.click timeout, "subtree intercepts pointer events"). Rezerwujemy
          miejsce na ikonkę (bez niej sama stopka nie wie o mascocie - siostrzany element w PlayerStage.tsx, nie
          potomek) - te same wymiary co `h-[76px] w-[76px] sm:h-24 sm:w-24` + `left-3` + mały margines. */}
      <div ref={footerRef} tabIndex={-1} className="shrink-0 pl-24 outline-none sm:pl-28">
        {current && (
          <button
            type="button"
            onClick={next}
            className="mb-4 min-h-[44px] rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {/* Nie "Dalej": ten napis ma przycisk nawigacji powłoki (dwa "Dalej" obok siebie myliłyby też czytniki ekranu). */}
            Następna kwestia
          </button>
        )}

        {hasNewMessages && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="mb-4 min-h-[44px] rounded-full border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
          >
            ↓ Nowe wiadomości
          </button>
        )}

        {availableQuestions.length > 0 && (
          <ul aria-label="Pytania do zadania" className="flex max-h-[40cqh] flex-wrap gap-2 overflow-y-auto">
            {/* Chipy: zadane pytanie znika stąd (zostaje w wątku wyżej) - lista pokazuje tylko to, co jeszcze można zapytać. */}
            {availableQuestions.map((question) => (
              <li key={question.id}>
                <button
                  type="button"
                  onClick={() => ask(question.id)}
                  aria-disabled={current !== null}
                  className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium ${
                    current !== null ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                  }`}
                >
                  {question.text}
                </button>
              </li>
            ))}
          </ul>
        )}

        <ExploreFooter done={doneCount} total={required.length} noun="pytań" verb="Zadano" readyText="Wszystkie wymagane pytania zadane." review={review} />
      </div>
    </div>
  );
}
