'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import AvatarDisplay from '@/app/courses/_components/AvatarDisplay';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { DEFAULT_IDLE, useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import MascotBanner from '../player/MascotBanner';
import ExploreFooter from './ExploreFooter';

// Odległość od dołu wątku (px), poniżej której uznajemy usera za "trzymającego się dołu" - autoprzewijanie po
// nowej wiadomości działa; powyżej tego progu user CZYTA historię, więc nie szarpiemy go w dół (fix/dialogue-sticky-questions).
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;
// Ten sam wzorzec co SceneHotspotsBlock.tsx (FOCUS_RING) - duplikowany per plik (prywatny const), nie importowany.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700';

// Kwestia postaci: avatar PRZY KAŻDEJ wiadomości (nie tylko w nagłówku) - jak w prawdziwym komunikatorze. Na poziomie
// MODUŁU (nie wewnątrz DialogueBlock): zdefiniowany w ciele komponentu dostawałby nową tożsamość przy KAŻDYM renderze
// rodzica, więc React odmontowywałby i montował na nowo WSZYSTKIE dymki wątku przy każdej zmianie stanu (progress,
// avatarFailed), nie tylko nowy - zbędna praca uzgadniania.
// `showAvatar` (fix/dialogue-polish): kolejne kwestie POD RZĄD (kilka linii jednego pytania wielokwestyjnego, ten
// sam `<li>`) pokazują avatar TYLKO przy OSTATNIEJ - jak w komunikatorach (wywołujący przekazuje
// `index === lines.length - 1`). Gdy `false`, w miejscu avatara zostaje TA SAMA pusta rezerwacja miejsca
// (`h-8 w-8`) co przy braku/błędzie obrazka - dymki wcześniejszych kwestii serii zostają wyrównane z ostatnią.
function CharacterBubble({
  avatarUrl,
  avatarFailed,
  onAvatarError,
  speakerName,
  showAvatar = true,
  children,
}: {
  avatarUrl: string | null;
  avatarFailed: boolean;
  onAvatarError: () => void;
  speakerName: string;
  showAvatar?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end gap-2">
      {showAvatar && avatarUrl && !avatarFailed ? (
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
      <p className="w-fit max-w-[70%] break-words rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
        <span className="sr-only">{speakerName}: </span>
        {children}
      </p>
    </div>
  );
}

// Dymek gracza (fix/dialogue-polish) - lustrzane odbicie CharacterBubble: avatar PO PRAWEJ (ten sam rozmiar, `size="sm"`
// w AvatarDisplay = h-8 w-8, jak avatar postaci), dymek w kolorze akcentu bez tła obrazka. Avatar dekoracyjny
// (`aria-hidden` na wrapperze - działa niezależnie od tego, którą gałąź renderuje AvatarDisplay: preset/upload/
// inicjały) - wiadomość i tak ma `sr-only` "Ty: " dla czytników ekranu, avatar nie niesie żadnej DODATKOWEJ
// informacji. Gracz w tym modelu treści ma zawsze DOKŁADNIE jedną wiadomość na pytanie (patrz DialogueBlock niżej),
// więc - w przeciwieństwie do CharacterBubble - nie ma tu serii do grupowania: avatar jest zawsze widoczny.
function PlayerBubble({ avatarUrl, initials, children }: { avatarUrl: string | null; initials?: string; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <p className="ml-auto w-fit max-w-[70%] break-words rounded-lg bg-indigo-600 px-3 py-2 text-white">
        <span className="sr-only">Ty: </span>
        {children}
      </p>
      <span aria-hidden="true" className="shrink-0">
        <AvatarDisplay avatarUrl={avatarUrl} size="sm" initials={initials} />
      </span>
    </div>
  );
}

// Rozmowa z postacią w stylu komunikatora: kwestie postaci Z LEWEJ z jej avatarem PRZY KAŻDEJ kwestii (nie tylko w nagłówku), pytania
// gracza Z PRAWEJ w kolorze akcentu, z avatarem gracza po prawej (PlayerBubble, fix/dialogue-polish - wcześniej bez
// avatara, tylko sr-only "Ty: "). Gracz wybiera pytanie z listy "chipów" pod rozmową; zadane pytanie
// znika z listy chipów (zostaje widoczne w wątku rozmowy). Postać odpowiada KWESTIAMI PO KOLEI (klik "Następna kwestia" w dymku, nie cały
// tekst naraz; odpowiedź bez `lines` to jedna kwestia). Pytanie liczy się jako zadane, gdy wszystkie kwestie zostały wypowiedziane;
// dopiero wtedy pytanie z notatką dopisuje wpis do notatnika (dowód, gdy `evidence`). Podczas rozmowy pozostałe pytania są nieaktywne.
// Notatki dopisywane są tylko poza podglądem (serwer i tak sam wylicza je przy zapisie bloku). Avatar postaci tylko przez <img> z bazy
// zasobów, avatar gracza przez AvatarDisplay (preset/upload/inicjały - `useMyAvatar`). Odpowiedź dla serwera: { asked: [id...] } w kolejności ukończenia.
//
// Układ komunikatora (fix/dialogue-sticky-questions): korzeń flex-1 flex-col (PlayerStage.tsx, contentLayout='fill'
// - ten sam CSS co scena SCENE_HOTSPOTS, patrz komentarz tam) - nagłówek/prompt shrink-0, WĄTEK jest JEDYNYM
// elementem, który się przewija (`<div role="log">` flex-1 overflow-y-auto opakowujący zwykły `<ol>` - NIE `<ol>`
// bezpośrednio, patrz komentarz przy tym divie niżej), stopka (przycisk "Następna kwestia", "Nowe wiadomości",
// chipy pytań, ExploreFooter) zostaje POZA obszarem przewijania - user nie musi już przewijać CAŁEGO bloku, żeby
// zobaczyć/kliknąć kolejne pytanie.
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
  /** Avatar gracza (dymki po prawej, fix/dialogue-polish) - z useMyAvatar w CoursePlayer.tsx, pobrany RAZ na wejście
      do kursu (nie tutaj - ten komponent remountuje się przy każdej zmianie bloku, patrz ExploratoryBlock.tsx). */
  myAvatarUrl?: string | null;
  myInitials?: string;
}) {
  const questions = block.questions ?? [];
  const character = block.character;
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const mascot = useMascotReaction();
  // Fooli jako pasek NAD nagłówkiem rozmowy (fix/dialogue-polish) - PlayerStage.tsx nic nie renderuje dla
  // contentLayout='fill' (DIALOGUE), bo tylko TEN komponent zna granicę "poza obszarem przewijania wątku"; ten sam
  // wzorzec co StageWithContext w CoursePlayer.tsx (reakcja zdarzenia wygrywa z pozą spoczynkową bloku/domyślną dla
  // typu - DEFAULT_IDLE nie ma dziś wpisu dla DIALOGUE, więc bez reakcji i bez `block.mascot` pasek po prostu się
  // nie renderuje, jak dziś). Gated `!review`: podgląd "Wstecz" dzieli TEN SAM MascotReactionProvider co żywy blok
  // (CoursePlayer.tsx), więc reakcja z live bloku mogłaby "przeciekać" do podglądu bez tego warunku.
  const idleMascot = block.mascot ? { pose: block.mascot.pose, text: block.mascot.text } : DEFAULT_IDLE.DIALOGUE;
  const bannerMascot = mascot.reaction ?? idleMascot;
  // Postęp rozmowy: ile kwestii każdego pytania już padło (kolejność = kolejność wyboru).
  const [progress, setProgress] = useState<{ id: string; shown: number }[]>([]);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // Nowe wiadomości doszły, gdy user NIE był "przy dole" wątku (patrz stickToBottomRef) - przycisk "Nowe wiadomości"
  // zamiast szarpania scrolla.
  const [hasNewMessages, setHasNewMessages] = useState(false);
  // Wątek (przewijany kontener - `role="log"` idzie na TEN div, NIE na `<ol>` poniżej, żeby nie nadpisać jego
  // domyślnej roli "list" i nie osierocić `<li>` - kod review).
  const logRef = useRef<HTMLDivElement>(null);
  // Stopka (przycisk "Następna kwestia"/"Nowe wiadomości"/chipy/ExploreFooter) - ZAWSZE w DOM (w przeciwieństwie do
  // samych chipów, renderowanych warunkowo), żeby mieć stabilny cel fokusu nawet gdy nie zostały już żadne pytania.
  const footerRef = useRef<HTMLDivElement>(null);
  // Lista chipów pytań - dedykowany ref zamiast szukania po `aria-label` (kod review: fragile na zmianę tekstu/i18n).
  const chipsRef = useRef<HTMLUListElement>(null);
  // Domyślnie true (świeżo otwarty blok jest "na dole" - jeszcze nic nie ma do przewinięcia) - aktualizowane w
  // handleScroll, czytane w efekcie autoprzewijania. Ref (nie state): odczyt/zapis w handlerach zdarzeń i efekcie,
  // bez potrzeby wywoływania re-renderu przy każdym scrollu.
  const stickToBottomRef = useRef(true);
  // Ostatni odczytany scrollTop wątku (handleScroll) - wyłącznie do wykrycia KIERUNKU kolejnego zdarzenia scroll,
  // patrz komentarz w handleScroll niżej (kod review: wyścig z animacją `scrollTo({behavior:'smooth'})`).
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

  // Kod review (fix/dialogue-sticky-questions): `scrollTo({behavior:'smooth'})` odpala zdarzenie `scroll` na KAŻDEJ
  // klatce animacji, nie raz na jej koniec - gdy user szybko klika kolejne pytania, nowa wiadomość (efekt wyżej)
  // może wystartować własny `scrollTo` w trakcie jeszcze trwającej animacji poprzedniego, a `scrollTop` w połowie
  // takiej klatki bywa >80px od (starego) dołu, mimo że to NIE jest user odjeżdżający od dołu, tylko nasza własna
  // animacja W TRAKCIE dojeżdżania. Odróżniamy to po KIERUNKU: tylko zdarzenie, w którym `scrollTop` ZMALAŁ
  // względem poprzedniego odczytu, jest prawdziwym "user przewinął w górę, czyta historię" i wolno mu wyłączyć
  // przyklejenie do dołu; każdy ruch w dół (czy to nasza animacja, czy user przewijający w dół ręcznie) nigdy go
  // nie wyłącza, może go najwyżej z powrotem włączyć po wejściu w próg 80px.
  function handleScroll() {
    const log = logRef.current;
    if (!log) return;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    const atBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    // "< poprzedni - 1", nie tylko "<" (kod review, druga runda): przy ułamkowym scrollTop (zoom/HiDPI) albo
    // przycięciu scrolla po zmniejszeniu scrollHeight bywa spadek o ułamek piksela, który NIE jest prawdziwym
    // ruchem w górę - 1px tolerancji odfiltrowuje taki szum, nie wpływając na wykrycie prawdziwego przewinięcia.
    const scrolledUp = log.scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = log.scrollTop;
    if (scrolledUp) {
      stickToBottomRef.current = atBottom;
    } else if (atBottom) {
      stickToBottomRef.current = true;
    }
    if (stickToBottomRef.current) setHasNewMessages(false);
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
    // flex-1 (NIE h-full) - ten sam, już sprawdzony wzorzec co korzeń SceneHotspotsBlock.tsx (`flex min-h-0 w-full
    // flex-1 flex-col`): flex-basis:0%+flex-grow:1 dostaje CAŁĄ dostępną przestrzeń przez algorytm flex, bez
    // polegania na procentowej wysokości (`h-full`/`height:100%`), która w zagnieżdżonym łańcuchu flex-column
    // WYMAGA definitywnej wysokości KAŻDEGO przodka po drodze, żeby się poprawnie rozwiązać - łatwiej się pomylić
    // (kod review: pierwotna wersja z `h-full` faktycznie działała TU poprawnie po naprawieniu właściwej przyczyny
    // niżej - sr-only w wątku - ale `flex-1` zostaje jako bardziej odporny, sprawdzony wzorzec, nie jako "the fix").
    // [container-type:size] - flex-1 DAJE mu definitywny rozmiar w obu osiach (bez okrężnej zależności - w
    // przeciwieństwie do karty hotspotu z height:auto, patrz globals.css), więc wystarczy, żeby chipy pytań niżej
    // mogły użyć jednostek cqh (max-h-[40cqh]) - zwykłe "%" NIC by nie dało: ich BEZPOŚREDNI rodzic (stopka,
    // shrink-0) nie ma definitywnej wysokości (sizuje się do treści), a procentowa max-height względem rodzica bez
    // definitywnej wysokości liczy się jako "none" (bez efektu) per spec CSS - cqh celuje w NAJBLIŻSZEGO PRZODKA
    // z container-type, czyli w TEN korzeń, pomijając stopkę po drodze.
    <div className="flex min-h-0 w-full flex-1 flex-col [container-type:size]">
      {!review && <MascotBanner pose={bannerMascot?.pose} text={bannerMascot?.text} />}
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

      {/* Wątek: JEDYNY przewijany element bloku (fix/dialogue-sticky-questions) - role="log"/aria-live IDZIE NA TEN
          <div> (NIE na <ol> poniżej - role="log" na <ol> nadpisywałby jego domyślną rolę "list" i osierocał <li>,
          axe-core "listitem without list parent"; kod review), tabIndex=0 (nie -1: ma być osiągalny Tab-em i
          przewijalny klawiaturą/strzałkami/PageDown, nie tylko celem programowego .focus()) + widoczny FOCUS_RING -
          ten kontener NIE dostaje fokusu programowo (po zadanym pytaniu fokus ląduje na chipie albo na stopce, patrz
          focusFooterAfterQuestionEnds niżej), więc ring pokazuje się wyłącznie przy prawdziwej nawigacji Tab, zgodnie
          z domyślną heurystyką :focus-visible przeglądarki - ten sam wzorzec co SceneHotspotsBlock.tsx.
          `relative` (kod review/layout-check.mjs - realny, subtelny bug): `<span className="sr-only">` wewnątrz
          każdego dymku (CharacterBubble, "Ty: ") to Tailwind `position:absolute` BEZ ustawionych
          top/left/right/bottom - bez top/left przeglądarka liczy jego pozycję jako "statyczną" (tam, gdzie
          wylądowałby, gdyby był position:static), ale będąc position:absolute jest WYJĘTY z normalnego przepływu i
          szuka NAJBLIŻSZEGO PRZODKA Z WŁASNYM position (nie static) jako "containing block". Bez `relative` TUTAJ
          tym przodkiem było content-area w PlayerStage.tsx (position:relative, kilka poziomów wyżej) - sr-only
          spany z KAŻDEJ wiadomości (nawet dawno przewiniętej poza widoczny obszar tego kontenera) ROSŁY w
          nieskończoność w dół (każda kolejna wiadomość przesuwa ich "statyczną" pozycję), NIE PRZYCINANE przez
          `overflow-y-auto` TEGO diva (bo ich containing block leżał POZA nim) - to WŁAŚNIE one nadymały scrollHeight
          obszaru bloku w PlayerStage.tsx (checkMainSceneFits w scripts/layout-check.mjs łapał to po wygenerowaniu
          >=8 wiadomości: obszar bloku zaczynał się przewijać, dokładnie to, co ten branch ma naprawić). Ten sam bug
          był DROBNY i niewidoczny w starym layoucie (`contentLayout='slide'`) - CAŁY panel i tak się przewijał,
          więc "wyciek" poza ten konkretny kontener nie miał znaczenia; ujawnił się dopiero z wewnętrznym scrollem.
          `relative` czyni ten div containing blockiem dla WŁASNYCH potomków position:absolute - sr-only spany
          zostają poprawnie przycięte razem z resztą wątku.
          `min-h-0` (NIE `min-h-[6rem]` - kod review, finding #2, druga runda): prompt/nagłówek/stopka są `shrink-0`
          (nie oddają miejsca), więc na bardzo niskich/poziomych viewportach (albo dużym powiększeniu przeglądarki)
          wątek MOŻE skurczyć się do 0px i zniknąć całkowicie. Rozważaliśmy rezerwację minimalnej wysokości (np.
          `min-h-[6rem]`), ale to pogarsza sprawę: stopka zawiera JEDYNE kontrolki do prowadzenia rozmowy (chipy
          pytań, "Następna kwestia") - wymuszona minimalna wysokość wątku obcina stopkę WCZEŚNIEJ (przy większej
          dostępnej wysokości) niż bez niej, tracąc kontrolki zamiast tylko historii. `min-h-0` (zwykłe zachowanie
          flex - pozwala się skurczyć do zera zamiast domyślnego `min-height:auto` liczonego z treści) zostawia
          priorytet stopce: ginie NAJPIERW historia (mniej dotkliwe - da się przewinąć z powrotem po zwiększeniu
          wysokości), kontrolki tracą miejsce dopiero, gdy sama suma shrink-0 elementów przekroczy dostępną wysokość.
          Pełne pokrycie WCAG 1.4.10 na wszystkich poziomach zoomu (np. składany nagłówek przy bardzo niskiej
          wysokości) to osobna decyzja projektowa, zgłoszona do backlogu (B-104 - numeracja po rebase na `main`,
          patrz D-079), nie hotfix na tym branchu. */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Historia rozmowy"
        tabIndex={0}
        onScroll={handleScroll}
        className={`relative min-h-0 flex-1 overflow-y-auto outline-none ${FOCUS_RING}`}
      >
        <ol className="space-y-3">
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
                <PlayerBubble avatarUrl={myAvatarUrl} initials={myInitials}>
                  {question.text}
                </PlayerBubble>
                {lines.map((line, index) => (
                  <CharacterBubble
                    key={index}
                    avatarUrl={avatarUrl}
                    avatarFailed={avatarFailed}
                    onAvatarError={onAvatarError}
                    speakerName={speakerName}
                    showAvatar={index === lines.length - 1}
                  >
                    {line}
                  </CharacterBubble>
                ))}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Stopka (poza obszarem przewijania - zawsze widoczna, jak lista akcji w komunikatorze): "Następna kwestia",
          "Nowe wiadomości" (gdy user czyta historię i doszła nowa), chipy pytań (max-h-[40cqh] - własny scroll, gdy
          jest ich dużo, na WSZYSTKICH breakpointach), ExploreFooter. role="group"/aria-label - czytnik ekranu
          ogłasza to jako spójną grupę akcji, nie luźne przyciski. tabIndex=-1 + FOCUS_RING na kontenerze - cel
          fokusu, gdy po ostatnim pytaniu nie zostały żadne chipy (focusFooterAfterQuestionEnds wyżej).
          BEZ `pl-24 sm:pl-28` (fix/dialogue-polish, B-103 rozwiązane w D-080) - ta rezerwacja miejsca istniała
          wyłącznie z powodu floating ikonki `MascotOverlay.tsx` (position:absolute, mogła wylądować dokładnie pod
          pierwszym chipem i łapać jego kliknięcia). Fooli w DIALOGUE nie jest już floating nakładką - PlayerStage.tsx
          nic nie renderuje dla contentLayout='fill', DialogueBlock renderuje WŁASNY MascotBanner NAD nagłówkiem
          rozmowy (patrz wyżej), w normalnym przepływie - nic nie może już wylądować pod stopką. */}
      <div
        ref={footerRef}
        role="group"
        aria-label="Pytania i postęp rozmowy"
        tabIndex={-1}
        className={`shrink-0 outline-none ${FOCUS_RING}`}
      >
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
          <ul ref={chipsRef} aria-label="Pytania do zadania" className="flex max-h-[40cqh] flex-wrap gap-2 overflow-y-auto">
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
