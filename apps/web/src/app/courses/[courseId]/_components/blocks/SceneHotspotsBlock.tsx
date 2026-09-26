'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, DoorOpen, Pause, Play } from 'lucide-react';
import type { ContentBlock, HotspotMedia, InnerHotspotMedia, InnerSceneHotspot, NestedScene, SceneHotspot } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { flattenHotspots } from '@/lib/flatten-hotspots';
import { useNotes, NoteKindIcon } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import { useOverlayLayer } from '../player/overlay-stack';
import ExploreFooter from './ExploreFooter';

type AnyHotspot = SceneHotspot | InnerSceneHotspot;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700';

// Hotspoty bywają geometrycznie zagnieżdżone (np. "karteczka" przyklejona do ramki "monitora" - mniejszy prostokąt
// częściowo/całkowicie wewnątrz większego). Bez jawnego z-index stackowanie idzie po kolejności DOM (= kolejności w
// treści modułu), nie po rozmiarze - większy hotspot renderowany PO mniejszym przykrywał mu klik w części wspólnej
// (produkcja: klik w "karteczkę" otwierał "monitor", bo monitor jest dalej w tablicy hotspots). z-index odwrotnie
// proporcjonalny do POLU ZADEKLAROWANEMU w treści (procenty szerokości×wysokości, nie wyrenderowanym pikselom -
// wystarczające, bo wszystkie hotspoty jednej sceny leżą na tym samym obrazie) naprawia to NIEZALEŻNIE od kolejności
// w treści - kolejność DOM (więc i Tab) zostaje dokładnie taka, jaką zdefiniował autor treści. Remis (dokładnie to
// samo pole): `Array.prototype.sort` jest stabilny (ES2019+), więc remisy zostają w kolejności z tablicy treści -
// późniejszy dostaje wyższy z-index, dokładnie odtwarzając wcześniejsze zachowanie po kolejności DOM. `Math.min(...,
// 29)`: hotspoty mają dziś twardy limit 20 w schemacie (`packages/content/src/blocks.ts`, `.max(20)`), więc nigdy nie
// osiągną z-index 30 nakładki karty (`z-30` niżej) - ale nic w tym pliku tego nie wymusza, więc obcinamy jawnie,
// zamiast polegać wyłącznie na limicie w innym pakiecie.
export function hotspotStackZIndex<T extends { id: string; width: number; height: number }>(all: T[]): Map<string, number> {
  const byAreaDesc = [...all].sort((a, b) => b.width * b.height - a.width * a.height);
  return new Map(byAreaDesc.map((hotspot, index) => [hotspot.id, Math.min(index + 1, 29)]));
}

// Scena z punktami: ilustracja (tylko <img>, nigdy inline SVG - D-051) z klikalnymi prostokątami w % obrazu - JEDYNA
// interakcja (feedback z produkcji po PR #32: usunięta lista przycisków-chipów pod obrazem). Każdy hotspot jest
// niewidocznym <button> nałożonym na obraz, w pełni dostępny: aria-label z tytułu (+ stan "obejrzane"/"drzwi
// zablokowane"), widoczny focus-ring (FOCUS_RING) - klawiatura i czytnik ekranu działają WYŁĄCZNIE przez te punkty,
// bez osobnej listy. Licznik "Obejrzano X z Y" (ExploreFooter) jest nad obrazem, mały.
//
// Karta hotspotu i media otwierają się jako NAKŁADKA NA SCENIE, NA obrazie (nie zamiast niego): position absolute;
// inset:0 ZAWSZE w obrębie kontenera obrazu (nigdy fixed względem viewportu - inaczej na mobile nakładka zasłoniłaby
// też licznik "Obejrzano X z Y" NAD obrazem, poza kontenerem sceny), tło rgba(43,36,64,.55) (kolor `ink` z palety
// scen) lekko przyciemnia obraz WIDOCZNY dookoła karty. Na >=640px (hotfix fix/hotspot-card-fit/B-101) karta ma
// STAŁY rozmiar 92% x 92% sceny i SAMA SIĘ NIE PRZEWIJA (produkcja: media wysokie - mail na ekranie, wydruk, zoom
// kalendarza, karteczka - wypychały kartę poza dostępne miejsce i ona się przewijała, zamiast zmieścić się jak
// scena) - układ (dwie kolumny na karcie szerokiej vs jedna na wąskiej/wysokiej) reaguje na WŁASNE proporcje karty
// przez container query (globals.css, `.hotspot-card`/`.hotspot-card-layout`) - tekst karty (.hotspot-card-text),
// pole dokumentu (DocumentMedia) i transkrypcja audio mają WŁASNY overflow-y-auto (przewijają się SAME, w swoim
// obszarze), gdy treść jest wyjątkowo długa; nic z tego nie rozciąga/przewija całej karty. Pełna scena (100%, nie pełny EKRAN - kontener obrazu, nie viewport)
// na mobile (<640px, bez zmian w tym PR - panorama/bottom sheet to PR B), tam karta nadal przewija się jako całość
// jak dawniej. Zagnieżdżona
// scena (media.kind:'scene') renderuje się w TEJ SAMEJ nakładce - jej hotspoty otwierają kolejny poziom (ten sam
// wzorzec, rekurencyjnie): stos maks. 2 poziomy (zewnętrzny hotspot -> zagnieżdżona scena -> jej hotspot), bo
// zagnieżdżanie ma zawsze dokładnie 1 poziom (innerHotspotSchema nie ma już własnego media.kind:'scene'). "Wróć"
// (i Escape, ten sam handler) zdejmuje jeden poziom: z maila do pulpitu, z pulpitu zamyka nakładkę. Fokus po każdej
// zmianie poziomu ląduje na nagłówku karty (kontekst dla czytnika ekranu); po CAŁKOWITYM zamknięciu wraca na
// przycisk, który otworzył nakładkę.
//
// Dowód zalicza się WYŁĄCZNIE przyciskiem "Dodaj do notatnika" (zmiana względem wcześniejszej wersji tego bloku,
// gdzie media zaliczały dowód od razu przy otwarciu karty - feedback z produkcji, D-071 zaktualizowane) - jednolicie
// dla wszystkich hotspotów z `evidence`, bez wyjątku dla mediów. Po kliknięciu przycisk zmienia się w statyczne
// "W notatniku ✓". Hotspoty bez `evidence` (np. kubek) nie mają tego przycisku, tylko "Wróć".
export default function SceneHotspotsBlock({
  block,
  contentBase,
  onSubmit,
  onReady,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { visited: string[]; noted: string[] }) => void;
  /** Zgłasza gotowość do "Dalej" w pasku powłoki (wymagane elementy pokryte) - CoursePlayer woła zwróconą funkcję zamiast osobnego "Kontynuuj". */
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
}) {
  const hotspots = block.hotspots ?? [];
  const hotspotZIndex = hotspotStackZIndex(hotspots);
  const flat = flattenHotspots(hotspots);
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const mascot = useMascotReaction();
  const [visited, setVisited] = useState<string[]>([]);
  const [noted, setNoted] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Id hotspotu WEWNĄTRZ zagnieżdżonej sceny bieżącego `active` (media.kind:'scene') - drugi (ostatni możliwy) poziom nakładki.
  const [nestedActiveId, setNestedActiveId] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // object-contain wyśrodkowany (feat/player-stage, PlayerStage contentLayout='scene'): kontener dostaje
  // aspect-ratio zmierzone z prawdziwego obrazu (onLoad ALBO - obraz z cache, kod review PR #44 - sprawdzenie
  // img.complete zaraz po zamontowaniu, bo React 18 nie odtwarza zdarzenia load dla <img>, które załadowało się z
  // cache PRZED hydratacją), więc hotspoty w % pozycjonują się DOKŁADNIE na wyrenderowanym obrazie, bez liczenia
  // offsetów w JS. Domyślne 16/10 (obrazy modułu 1 mają tę proporcję) - tylko na czas ładowania, żeby kontener nie
  // zapadał się do zera wysokości, zanim poznamy prawdziwą wartość.
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Audio: id hotspotów (dowolnego poziomu), których nagranie zostało odsłuchane do końca (onEnded) - odsłania insight (content).
  const [listenedIds, setListenedIds] = useState<string[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const overlayTriggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const imageUrl = contentAssetUrl(contentBase, block.image, 'image');
  const active = hotspots.find((hotspot) => hotspot.id === activeId) ?? null;
  const nestedScene = active?.media?.kind === 'scene' ? active.media.scene : undefined;
  const activeInner = nestedScene?.hotspots.find((hotspot) => hotspot.id === nestedActiveId) ?? null;
  const current: AnyHotspot | null = activeInner ?? active;
  const transcriptId = useId();
  const overlayTitleId = useId();

  // "Drzwi" (action:'next', B-086/D-071) WYKLUCZONE z puli required: nigdy nie trafiają do `visited` same z siebie
  // (klik od razu kończy blok) - inaczej scena z SAMYMI drzwiami (np. "korytarz", bez innych hotspotów) nigdy nie
  // mogłaby się ukończyć (fallback bez jawnych flag required liczyłby "wszystkie", czyli same drzwi). Ta sama reguła
  // co server-side (evaluate.ts) i walidacja modułu (semantics.ts).
  const doorIds = new Set(hotspots.filter((hotspot) => hotspot.action === 'next').map((hotspot) => hotspot.id));
  const required = requiredItemIds(
    flat.filter((hotspot) => !doorIds.has(hotspot.id)),
    block.requiredHotspots,
  );
  const doneCount = required.filter((id) => visited.includes(id)).length;
  const ready = doneCount >= required.length;
  const hasDoor = doorIds.size > 0;
  useCompleteReaction(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    // Z drzwiami blok NIGDY nie zgłasza gotowości przez pasek - jedynym wyjściem jest klik w drzwi (CoursePlayer.tsx
    // chowa wtedy "Dalej" paska, hideForward).
    onReady(!hasDoor && ready ? () => onSubmit({ visited, noted }) : null);
    // onReady/onSubmit celowo poza deps - patrz wyjaśnienie w SceneHotspotsBlock.tsx (remount przez `key` na zmianę bloku, nie "stabilność").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visited, noted, review, hasDoor]);

  // Zmiana poziomu nakładki (otwarcie, zejście głębiej, "Wróć"): transkrypcja się zwija, fokus ląduje na nagłówku
  // karty (kontekst dla czytnika ekranu przy zmianie treści w tej samej nakładce). useLayoutEffect (nie useEffect,
  // code review po commicie 367743b): przycisk, który otworzył nakładkę, dostaje w TYM SAMYM renderze aria-hidden -
  // gdyby przeglądarka zdążyła go najpierw namalować ze skupieniem (natywne "klik = fokus") i DOPIERO PÓŹNIEJ (po
  // pierwszym malowaniu, useEffect) przenieść fokus na nagłówek, powstałaby klatka z aria-hidden="true" na
  // skupionym elemencie (złamanie reguły WAI-ARIA/axe-core "aria-hidden-focus"). useLayoutEffect przenosi fokus
  // synchronicznie, przed malowaniem.
  useLayoutEffect(() => {
    setTranscriptOpen(false);
    if (current) headingRef.current?.focus();
  }, [activeId, nestedActiveId, current]);

  // Escape zdejmuje jeden poziom nakładki - ten sam handler co przycisk "Wróć". Zarejestrowane w overlay-stack
  // (LIFO wg kolejności otwarcia - overlay-stack.tsx) zamiast WŁASNEGO document.addEventListener - PlayerStage ma
  // JEDEN nasłuch Escape na całą ramkę i woła closeTop(), który trafia dokładnie tutaj, dopóki karta jest otwarta
  // (na którymkolwiek z dwóch poziomów - goBack sam zdejmuje tylko jeden, więc drugi Escape trafi tu ponownie).
  useOverlayLayer('hotspotCard', activeId !== null, goBack);

  // Obraz z cache przeglądarki: React 18 nie odtwarza zdarzenia `load` dla <img>, które załadowało się PRZED
  // hydratacją (React #15446) - samo onLoad niżej by tego nie złapało. Sprawdzenie zaraz po (re)montowaniu tego
  // bloku (deps: imageUrl - nowa scena to nowy obraz) łapie ten przypadek; gdy obraz jeszcze się ładuje, complete
  // jest false i zostaje domyślne 16/10 do czasu prawdziwego onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setAspectRatio(img.naturalWidth / img.naturalHeight);
    }
  }, [imageUrl]);

  function markVisited(id: string) {
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
  }

  function open(id: string, trigger: HTMLButtonElement | null) {
    setInteracted(true);
    overlayTriggerRef.current = trigger;
    setActiveId(id);
    // Obronnie (code review, D-073): poprawność stosu 2-poziomowego opiera się na tym, że nie da się otworzyć innego
    // zewnętrznego hotspotu, gdy nakładka jest już otwarta (przycisk jest wtedy zasłonięty i poza kolejnością Tab) -
    // ale to inwariant UI, nie coś, na czym stan POWINIEN polegać. Jawny reset na wypadek, gdyby ten inwariant kiedyś
    // przestał obowiązywać (np. przez przyszły refaktor): bez tego nowo otwarty zewnętrzny hotspot mógłby pokazać
    // "current" ze STAREJ zagnieżdżonej sceny, gdyby miała hotspot o tym samym id.
    setNestedActiveId(null);
    markVisited(id);
  }

  // Drzwi (action:'next'): nigdy nie otwierają kartę - gotowe (ready) kończą blok od razu, jak przycisk "Dalej" w
  // pasku; przed tym klik nic nie robi (przycisk jest wtedy aria-disabled, ale klawiatura/dotyk i tak trafiają tutaj).
  function clickDoor() {
    if (!review && ready) onSubmit({ visited, noted });
  }

  function handleHotspotClick(hotspot: SceneHotspot, trigger: HTMLButtonElement | null) {
    if (hotspot.action === 'next') clickDoor();
    else open(hotspot.id, trigger);
  }

  function openNested(id: string) {
    setInteracted(true);
    setNestedActiveId(id);
    markVisited(id);
  }

  // "Wróć": z poziomu maila (nestedActiveId) cofa do pulpitu; z pulpitu/karty najwyższego poziomu zamyka nakładkę
  // i oddaje fokus przyciskowi, który ją otworzył.
  function goBack() {
    if (nestedActiveId) {
      setNestedActiveId(null);
      return;
    }
    if (activeId) {
      const trigger = overlayTriggerRef.current;
      setActiveId(null);
      trigger?.focus();
    }
  }

  function addToNotepad(id: string) {
    const hotspot = flat.find((candidate) => candidate.id === id);
    if (!hotspot?.evidence || !hotspot.note || noted.includes(id) || review || !block.id) return;
    setNoted((current) => [...current, id]);
    addNote({ blockId: block.id, text: hotspot.note.text, kind: hotspot.note.kind });
    evidence.addPending(`${block.id}.${id}`);
    mascot.react('evidence');
  }

  const isNoted = (id: string) => noted.includes(id);

  return (
    // flex h-full flex-col (kod review PR #44): PlayerStage (contentLayout='scene') daje temu blokowi PEŁNĄ
    // wysokość obszaru treści - żeby scena faktycznie się w niej ZMIEŚCIŁA (nie tylko dopasowała szerokością), ten
    // korzeń musi przekazać tę wysokość w dół: nagłówek (prompt/licznik) shrink-0, kontener obrazu flex-1 min-h-0
    // (dopiero to daje mu JAWNĄ wysokość, żeby max-h-full na kwadracie aspect-ratio niżej cokolwiek znaczyło -
    // wcześniej max-h-full liczyło się względem rodzica o wysokości auto, czyli "none").
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="shrink-0">
        {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
        <p className="mb-2 text-sm text-slate-600">Wybierz elementy sceny, aby dowiedzieć się więcej.</p>
        <ExploreFooter done={doneCount} total={required.length} noun="elementów" review={review} className="mb-2 text-xs text-slate-500" />
      </div>

      {imageUrl && !imageFailed && (
        // [container-type:size] TUTAJ, nie tylko na komórce bloku w PlayerStage.tsx (hotfix fix/player-scene-fit):
        // ten div jest JUŻ flex-1 min-h-0 PO odjęciu wysokości nagłówka (shrink-0) wyżej przez flexbox - gdyby
        // kwadrat aspect-ratio niżej liczył cqw/cqh względem WIĘKSZEJ komórki bloku w PlayerStage (przed odjęciem
        // nagłówka), mógłby wyjść wyższy niż realnie dostępne miejsce i i tak by się nie zmieścił (ucięty przez
        // overflow-hidden komórki, zamiast poprawnie dopasowany). Zagnieżdżony kontener zapytań to poprawia: cqw/cqh
        // wewnątrz odnoszą się do NAJBLIŻSZEGO przodka z container-type, czyli do TEGO diva.
        <div className="relative flex min-h-0 flex-1 items-center justify-center [container-type:size]">
          {/* isolate (code review PR #36): hotspoty dostały jawny z-index (1..20, hotspotStackZIndex) i bez WŁASNEGO
              kontekstu stackowania (isolation: isolate) ten numeryczny z-index konkurowałby z ROOT kontekstem strony -
              konkretnie z lepkim dolnym paskiem "Wstecz/Dalej" (PlayerShell.tsx, sticky bottom-0, bez z-index): hotspot
              malowałby się NAD paskiem i przechwytywał jego kliknięcia, gdy scena przewinie się pod pasek. isolate
              zamyka 1..20 (hotspoty) i 30 (nakładka karty) w jednej, lokalnej warstwie - na zewnątrz kontener sceny
              znów maluje się po prostu w kolejności DOM, jak przed tym z-index. WAŻNE (hotfix fix/mascot-overlap):
              ta izolacja oznacza, że z-30 karty NIE JEST w ogóle porównywane z z-index poza tym kontenerem (np.
              MascotOverlay.tsx, z-10) - z punktu widzenia reszty strony cała wyizolowana scena liczy się jako jedna
              warstwa bez własnego z-index. Dlatego to NIE z-index chroni dymek Fooli przed przykryciem karty - robi
              to `useAnyOverlayOpen()` w MascotOverlay.tsx (chowa ikonkę/dymek całkowicie, gdy karta jest otwarta).
              Podniesienie samego z-30 tutaj by tego nie naprawiło.
              Rozmiar (hotfix fix/player-scene-fit/B-100): CZYSTY CSS "contain" bez JS (bez max-h-full - liczyło się
              względem rodzica, którego wysokość zależy od NIEGO SAMEGO w niektórych trybach - i bez ResizeObservera).
              width: min(100cqw, 100cqh*proporcja) - mniejsza z dwóch możliwych szerokości (ograniczona szerokością
              albo wysokością kontenera zapytań), height: auto + aspect-ratio dopełnia resztę. margin: auto centruje
              w obu osiach (oprócz i tak już centrującego items-center/justify-center wyżej - należy do tej samej
              formuły, nie jest zbędne, gdyby te dwie klasy kiedyś zniknęły). */}
          <div
            className="relative isolate overflow-hidden rounded border border-slate-200"
            style={
              {
                '--scene-ratio': String(aspectRatio),
                width: 'min(100cqw, calc(100cqh * var(--scene-ratio)))',
                height: 'auto',
                aspectRatio: 'var(--scene-ratio)',
                margin: 'auto',
              } as React.CSSProperties
            }
          >
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt={block.imageAlt ?? ''}
            referrerPolicy="no-referrer"
            aria-hidden={activeId ? true : undefined}
            className="block h-full w-full object-contain"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
            }}
            onError={() => setImageFailed(true)}
          />
          {hotspots.map((hotspot) => {
            const seen = visited.includes(hotspot.id);
            const isDoor = hotspot.action === 'next';
            const blocked = isDoor && !ready;
            const label = isDoor
              ? blocked
                ? `${hotspot.label}: zbierz najpierw dowody (${doneCount}/${required.length})`
                : hotspot.label
              : `${hotspot.label}${seen ? ' (obejrzane)' : ''}`;
            return (
              <button
                key={hotspot.id}
                type="button"
                data-testid={`hotspot-overlay-${hotspot.id}`}
                data-state={isDoor ? (ready ? 'ready' : 'blocked') : seen ? 'discovered' : interacted ? 'hidden' : 'hint'}
                aria-label={label}
                // Nieaktywne drzwi zostają SKUPIALNE (aria-disabled, nie natywne disabled) - czytnik ekranu ma usłyszeć
                // DLACZEGO, zamiast po prostu pominąć przycisk. Gdy nakładka jest otwarta, punkty pod nią wychodzą z
                // kolejności Tab i dostają aria-hidden (kontener sceny z obrazem i hotspotami ZOSTAJE w DOM pod
                // nakładką - feedback z produkcji; aria-hidden to dodatkowa, bardziej niezawodna warstwa niż samo
                // poleganie na aria-modal czytnika), bez pełnego focus trapu w nakładce.
                aria-disabled={blocked}
                aria-hidden={activeId ? true : undefined}
                title={blocked ? `Zbierz najpierw dowody: ${doneCount}/${required.length}` : undefined}
                tabIndex={activeId ? -1 : undefined}
                onClick={(event) => handleHotspotClick(hotspot, event.currentTarget)}
                style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%`, zIndex: hotspotZIndex.get(hotspot.id) }}
                className={`absolute min-h-[24px] min-w-[24px] rounded border-2 outline-none transition-colors ${FOCUS_RING} ${
                  isDoor
                    ? ready
                      ? 'border-amber-500 bg-amber-400/20 hover:border-amber-600 hover:bg-amber-400/30'
                      : 'cursor-not-allowed border-slate-400/50 bg-slate-400/10'
                    : `hover:border-indigo-600 hover:bg-indigo-500/20 ${
                        seen
                          ? 'border-green-600 bg-green-500/[0.07]'
                          : interacted
                            ? 'border-transparent'
                            : 'border-indigo-400/70 bg-indigo-500/10 motion-safe:animate-pulse'
                      }`
                }`}
              >
                {isDoor && <DoorOpen aria-hidden="true" className="pointer-events-none mx-auto h-4 w-4 text-amber-800" />}
                {!isDoor && seen && (
                  <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
                    <Check aria-hidden="true" className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}

          {activeId && current && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={overlayTitleId}
              className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(43,36,64,0.55)]"
            >
              {/* Nakładka NA scenie, nie zamiast niej. Mobile (<640px, bez zmian w tym PR): karta zajmuje cały ekran
                  i przewija się jako całość - feedback z produkcji (`feat/scene-overlay-fix`). >=640px (hotfix
                  fix/hotspot-card-fit): rozmiar 92%x92% i `.hotspot-card`/`.hotspot-card-layout` (globals.css) -
                  container query na WŁASNYCH proporcjach karty przełącza dwie kolumny (media|tekst+przyciski) na
                  szerokiej karcie w jedną kolumnę (tekst, media, przyciski) na wąskiej/wysokiej. */}
              <div
                className={`hotspot-card ${current.media ? '' : 'hotspot-card--no-media'} flex h-full w-full flex-col overflow-y-auto bg-white p-4 shadow-xl sm:h-[92%] sm:w-[92%] sm:overflow-visible sm:rounded sm:p-4`}
              >
                {/* .hotspot-card-layout/-text/-media/-buttons: BEZ własnych klas flex/grid Tailwind (poza spacingiem
                    mobile niżej) - poniżej 640px to zwykłe divy w naturalnym przepływie (mt-3/mt-4 odtwarzają dawny
                    odstęp, karta CAŁA się przewija jak przed tym hotfixem); grid/container query (display:grid,
                    grid-area, min-height/width, wyśrodkowanie mediów) to WYŁĄCZNIE globals.css od 640px wzwyż - tak,
                    żeby żadna klasa Tailwind nie konkurowała z `display:grid` z @media (ten sam wzorzec co
                    .player-frame: zwykłe klasy CSS NIŻEJ w wygenerowanym arkuszu niż @tailwind utilities wygrywają
                    bez !important). */}
                <div className="hotspot-card-layout">
                  <div className="hotspot-card-text">
                    <h3 id={overlayTitleId} ref={headingRef} tabIndex={-1} className="mb-2 text-sm font-semibold text-slate-900 outline-none">
                      {current.label}
                    </h3>
                    <HotspotText hotspot={current} listened={listenedIds.includes(current.id)} />
                  </div>

                  {/* Bez mediów (druga runda code review, punkt 9): TEN div w ogóle nie renderuje się - nie tylko
                      HotspotMediaArea zwraca null wewnątrz niego. Puste .hotspot-card-media zostałoby elementem
                      siatki bez odpowiednika w grid-template-areas karty bez mediów (.hotspot-card--no-media, tam
                      nie ma obszaru "media") - CSS Grid umieściłby taki "osierocony" element w niejawnej siatce w
                      nieprzewidywalnym miejscu, zamiast po prostu go nie mieć. */}
                  {current.media && (
                    <div className="hotspot-card-media mt-3 sm:mt-0">
                      <HotspotMediaArea
                        hotspot={current}
                        contentBase={contentBase}
                        transcriptOpen={transcriptOpen}
                        transcriptId={transcriptId}
                        onToggleTranscript={() => setTranscriptOpen((open) => !open)}
                        onEnded={() => setListenedIds((list) => (list.includes(current.id) ? list : [...list, current.id]))}
                        visited={visited}
                        interacted={interacted}
                        nestedOverlayOpen={!!nestedActiveId}
                        onPickNested={openNested}
                      />
                    </div>
                  )}

                  <div className="hotspot-card-buttons mt-4 flex flex-wrap gap-2 sm:mt-0">
                    {current.evidence && current.note && !review && (
                      <>
                        {isNoted(current.id) ? (
                          <p className="inline-flex min-h-[44px] items-center gap-2 rounded px-1 text-sm font-medium text-green-700">
                            <NoteKindIcon kind={current.note.kind} />W notatniku ✓
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addToNotepad(current.id)}
                            className={`min-h-[44px] rounded border border-indigo-600 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 outline-none hover:bg-indigo-100 ${FOCUS_RING}`}
                          >
                            Dodaj do notatnika
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={goBack}
                      className={`min-h-[44px] rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none hover:bg-slate-50 ${FOCUS_RING}`}
                    >
                      Wróć
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tekst karty (bez tytułu, renderowanego osobno przez rodzica) - hotspot.content, WYŁĄCZNIE gdy media nie jest audio
// (audio odsłania go dopiero po odsłuchaniu, patrz `listened` niżej - to samo bramkowanie co przed rozdzieleniem
// tekstu i mediów na osobne obszary siatki, fix/hotspot-card-fit). BEZ line-clamp/title (druga runda code review,
// punkt 4: `title` jako sposób doczytania przyciętego tekstu działa tylko na hover myszą - na dotyku/klawiaturze,
// gdzie układ wąski/wysoki się typowo włącza, nie da się go w ogóle zobaczyć). Obszar .hotspot-card-text ma WŁASNY
// overflow-y-auto (globals.css) - długi tekst przewija się SAM, karta i pozostałe obszary (media, przyciski)
// zostają nietknięte.
function HotspotText({ hotspot, listened }: { hotspot: AnyHotspot; listened: boolean }) {
  const isAudio = hotspot.media?.kind === 'audio';
  if (isAudio && !listened) return null;
  if (!hotspot.content) return null;
  return <p className="whitespace-pre-line text-slate-800">{hotspot.content}</p>;
}

// Media (bez tekstu - HotspotText renderuje się osobno, w INNYM obszarze siatki karty) współdzielone przez kartę
// zewnętrznego hotspotu i kartę hotspotu wewnątrz zagnieżdżonej sceny - obie zachowują się identycznie poza tym, że
// wewnętrzna nigdy nie ma media.kind:'scene' (typ to wymusza, więc ta gałąź po prostu nie występuje dla
// InnerSceneHotspot). Przycisk dowodu i "Wróć" renderuje RODZIC (SceneHotspotsBlock) - "pod spodem dwa przyciski"
// jest wspólne dla wszystkich poziomów nakładki, nie część "mediów".
function HotspotMediaArea({
  hotspot,
  contentBase,
  transcriptOpen,
  transcriptId,
  onToggleTranscript,
  onEnded,
  visited,
  interacted,
  nestedOverlayOpen,
  onPickNested,
}: {
  hotspot: AnyHotspot;
  contentBase: string;
  transcriptOpen: boolean;
  transcriptId: string;
  onToggleTranscript: () => void;
  onEnded: () => void;
  visited: string[];
  interacted: boolean;
  nestedOverlayOpen: boolean;
  onPickNested: (id: string) => void;
}) {
  const media = hotspot.media;
  // media.scene osobno (nie tylko media?.kind === 'scene' && media.scene): HotspotMedia to jeden płaski interfejs
  // (courses-types.ts), nie prawdziwa unia dyskryminowana - sprawdzenie .kind nie zawęża TypeScriptowi opcjonalności
  // .scene. Prawda/fałsz osobnej stałej TS już zawęża poprawnie (ten sam wzorzec co wcześniej nestedScene w rodzicu).
  const scene = media?.kind === 'scene' ? media.scene : undefined;
  if (!media) return null;
  return (
    <>
      {media.kind === 'image' && <ImageMedia contentBase={contentBase} media={media} />}

      {media.kind === 'document' && <DocumentMedia media={media} />}

      {media.kind === 'audio' && (
        <AudioMedia
          // key: wymuszony remount (nie tylko re-render tej samej instancji) przy przejściu na INNY hotspot audio -
          // stan (playing/currentTime/pokazanaTranskrypcja) i autoodtwarzanie przy otwarciu mają zawsze dotyczyć
          // aktualnego hotspotu, nie resztek po poprzednim. Dziś to i tak zawsze prawda strukturalnie (przejście
          // między dwoma hotspotami audio idzie zawsze przez stan bez audio - zamknięcie nakładki albo widok sceny
          // zagnieżdżonej), ale `key` nie polega na tym inwariancie (D-073: "to inwariant UI, nie coś, na czym stan
          // POWINIEN polegać").
          key={hotspot.id}
          contentBase={contentBase}
          media={media}
          transcriptOpen={transcriptOpen}
          transcriptId={transcriptId}
          onToggleTranscript={onToggleTranscript}
          onEnded={onEnded}
        />
      )}

      {scene && (
        <NestedSceneImage
          contentBase={contentBase}
          scene={scene}
          visited={visited}
          interacted={interacted}
          overlayOpen={nestedOverlayOpen}
          onPick={onPickNested}
        />
      )}
    </>
  );
}

// Obraz zagnieżdżonej sceny z klikalnymi prostokątami - ten sam wzorzec dostępności co główna ilustracja bloku
// (aria-label, focus-ring, bez chipów): klik otwiera KOLEJNY poziom tej samej nakładki (SceneHotspotsBlock's
// nestedActiveId), nie nową nakładkę. Rozmiar (hotfix fix/hotspot-card-fit) - TA SAMA formuła "contain" co scena
// najwyższego poziomu (min(100cqw, 100cqh*proporcja) we WŁASNYM, zagnieżdżonym [container-type:size]) - ale TYLKO od
// 640px wzwyż (druga runda code review, punkt 1): poniżej tego progu karta się przewija jako całość i NIE ma jawnej
// wysokości do zapytania (100cqh liczyłoby się jako 0, więc formuła "contain" dałaby szerokość 0 - gorzej niż przed
// tym hotfixem). Na mobile zostaje zwykłe `w-full` (Tailwind, bez jednostek kontenera zapytań) z aspect-ratio -
// naturalna wysokość z proporcji obrazu, bez cqh. `sm:[container-type:size]` na kontenerze + `.hotspot-nested-scene-box`
// (globals.css) nadpisujący `width` formułą "contain" WYŁĄCZNIE od 640px (ten sam wzorzec co .player-frame - zwykła
// klasa CSS niżej w arkuszu niż @tailwind utilities wygrywa bez !important) - inline style zostaje tylko dla
// aspect-ratio/height/margin, które są poprawne na KAŻDYM breakpoincie.
function NestedSceneImage({
  contentBase,
  scene,
  visited,
  interacted,
  overlayOpen,
  onPick,
}: {
  contentBase: string;
  scene: NestedScene;
  visited: string[];
  interacted: boolean;
  overlayOpen: boolean;
  onPick: (id: string) => void;
}) {
  const url = contentAssetUrl(contentBase, scene.image, 'image');
  // Domyślne 16/10 tylko na czas ładowania (jak w scenie najwyższego poziomu) - cache-check zaraz po zamontowaniu:
  // React 18 nie odtwarza zdarzenia `load` dla obrazu załadowanego z cache PRZED hydratacją (React #15446).
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setAspectRatio(img.naturalWidth / img.naturalHeight);
    }
  }, [url]);
  if (!url) return null;
  const zIndex = hotspotStackZIndex(scene.hotspots);
  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center sm:[container-type:size]">
      {/* isolate: patrz komentarz przy analogicznym kontenerze wyżej (scena najwyższego poziomu) - ten kontener jest już
          zagnieżdżony w karcie nakładki (z-30), ale jego WŁASNE hotspoty (z-index 1..20) i tak nie powinny wyciekać poza
          niego, dla spójności i na wypadek przyszłych zmian layoutu karty. */}
      <div
        className="hotspot-nested-scene-box relative isolate w-full overflow-hidden rounded border border-slate-200"
        style={
          {
            '--scene-ratio': String(aspectRatio),
            height: 'auto',
            aspectRatio: 'var(--scene-ratio)',
            margin: 'auto',
          } as React.CSSProperties
        }
      >
      {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL */}
      <img
        ref={imgRef}
        src={url}
        alt={scene.imageAlt}
        referrerPolicy="no-referrer"
        aria-hidden={overlayOpen ? true : undefined}
        className="block h-full w-full object-contain"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
        }}
      />
      {scene.hotspots.map((hotspot) => {
        const seen = visited.includes(hotspot.id);
        return (
          <button
            key={hotspot.id}
            type="button"
            data-testid={`hotspot-overlay-${hotspot.id}`}
            aria-label={`${hotspot.label}${seen ? ' (obejrzane)' : ''}`}
            aria-hidden={overlayOpen ? true : undefined}
            tabIndex={overlayOpen ? -1 : undefined}
            onClick={() => onPick(hotspot.id)}
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%`, zIndex: zIndex.get(hotspot.id) }}
            className={`absolute min-h-[24px] min-w-[24px] rounded border-2 outline-none transition-colors hover:border-indigo-600 hover:bg-indigo-500/20 ${FOCUS_RING} ${
              seen ? 'border-green-600 bg-green-500/[0.07]' : interacted ? 'border-transparent' : 'border-indigo-400/70 bg-indigo-500/10 motion-safe:animate-pulse'
            }`}
          >
            {seen && (
              <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
                <Check aria-hidden="true" className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}

function ImageMedia({ contentBase, media }: { contentBase: string; media: HotspotMedia | InnerHotspotMedia }) {
  const url = contentAssetUrl(contentBase, media.src, 'image');
  if (!url) return null;
  // Powiększenie wprost w karcie (bez osobnej nakładki). max-h-[45vh] na mobile (bez zmian - karta się tam przewija
  // jak dawniej); od 640px wzwyż .hotspot-card-media (globals.css) daje mu realną, ograniczoną wysokość obszaru
  // mediów karty (92%x92%, bez przewijania) - sm:h-full/sm:max-h-full wypełnia ją, object-contain robi resztę.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
    <img
      src={url}
      alt={media.alt ?? ''}
      referrerPolicy="no-referrer"
      className="w-full max-h-[45vh] rounded border border-slate-200 object-contain sm:h-full sm:max-h-full"
    />
  );
}

function DocumentMedia({ media }: { media: HotspotMedia | InnerHotspotMedia }) {
  return (
    // Pole dokumentu (ten <pre>) przewija się wewnątrz siebie (jak .hotspot-card-text/transkrypcja audio), nie
    // cała karta - max-h-[35vh] na mobile (bez zmian), sm:max-h-full wypełnia realną wysokość obszaru mediów
    // karty (.hotspot-card-media, globals.css) od 640px wzwyż.
    <div className="flex h-full min-h-0 w-full flex-col">
      {media.title && <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{media.title}</h4>}
      <pre className="min-h-0 max-h-[35vh] flex-1 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-3 font-mono text-sm leading-relaxed text-slate-100 sm:max-h-full">
        {media.lines?.join('\n')}
      </pre>
    </div>
  );
}

// Czas w m:ss. `seconds` bywa NaN (metadane audio jeszcze się nie wczytały - preload="metadata") - wtedy "0:00", nie NaN:NaN.
function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Własny odtwarzacz (bez natywnych <audio controls>) - feedback z produkcji (feat/scene-overlay-fix): zbliżenie
// (media.image, opcjonalne) nad małym przyciskiem play/pauza z cienkim paskiem postępu i czasem. Autoodtwarzanie przy
// otwarciu hotspotu (klik = gest użytkownika, więc dozwolone); gdy przeglądarka i tak odrzuci play() (rzadkie, ale
// możliwe np. przy restrykcyjnych ustawieniach), przycisk zostaje po prostu w stanie "play" - BEZ komunikatu o
// błędzie (inaczej niż NarrationBar.tsx/useNarrationBar.ts, na życzenie: to poboczny efekt dźwiękowy w karcie, nie główna narracja).
function AudioMedia({
  contentBase,
  media,
  transcriptOpen,
  transcriptId,
  onToggleTranscript,
  onEnded,
}: {
  contentBase: string;
  media: HotspotMedia | InnerHotspotMedia;
  transcriptOpen: boolean;
  transcriptId: string;
  onToggleTranscript: () => void;
  onEnded: () => void;
}) {
  const url = contentAssetUrl(contentBase, media.audioUrl, 'audio');
  const imageUrl = contentAssetUrl(contentBase, media.image, 'image');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  // Transkrypcja ZAMIENIA widok zbliżenia (media.image), nie dokłada się pod nim (hotfix fix/hotspot-card-fit,
  // wcześniej: transkrypcja zawsze w DOM, tylko `hidden` - dokładała wysokość pod obrazkiem i odtwarzaczem, karta
  // się wtedy wydłużała/przewijała). Play/pauza i pasek postępu ZOSTAJĄ zawsze widoczne pod tym widokiem - sterują
  // odtwarzaniem niezależnie od tego, co jest akurat pokazane w miejscu obrazka. NIEZALEŻNA od `url` (druga runda
  // code review, punkt 7): transkrypcja jest tekstową alternatywą dla audio (WCAG 1.2.1) - jest najbardziej
  // potrzebna właśnie wtedy, gdy plik audio się nie wczytał; wcześniejsza wersja tego hotfixu chowała cały ten
  // blok razem z odtwarzaczem pod `{url && ...}`, więc przycisk "Transkrypcja" nic nie pokazywał, gdy `url` było
  // puste - regresja względem kodu SPRZED tego hotfixu, gdzie transkrypcja była zawsze niezależna.
  const showingTranscript = transcriptOpen && !!media.transcript;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        {showingTranscript ? (
          // role="region" aria-label (nie aria-controls/aria-expanded na przycisku niżej - stała etykieta +
          // aria-pressed, druga runda code review punkt 6): tabIndex=0 + overflow-y-auto - transkrypcja bywa
          // dłuższa niż dostępna wysokość obszaru mediów karty, MUSI się przewijać sama (jak DocumentMedia), nie
          // ucinać (WCAG 1.2.1 - to jedyna tekstowa alternatywa dla audio, obcięcie części to utrata treści).
          <div id={transcriptId} role="region" aria-label="Transkrypcja" tabIndex={0} className="h-full overflow-y-auto rounded border border-slate-200 bg-white p-3">
            <p className="whitespace-pre-line text-sm text-slate-700">{media.transcript}</p>
          </div>
        ) : (
          // Mobile: bez max-h (bez zmian - jak przed tym hotfixem, zbliżenie audio nigdy nie miało limitu
          // wysokości, w przeciwieństwie do ImageMedia); sm:h-full/sm:max-h-full wypełnia obszar mediów karty od
          // 640px.
          url &&
          imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
            <img
              src={imageUrl}
              alt={media.alt ?? ''}
              referrerPolicy="no-referrer"
              className="w-full rounded border border-slate-200 object-contain sm:h-full sm:max-h-full"
            />
          )
        )}
      </div>
      {url && (
        <>
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            hidden
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onEnded={() => {
              setPlaying(false);
              onEnded();
            }}
          />
          <div className="mt-3 flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pauza' : 'Odtwórz'}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-indigo-600 bg-indigo-50 text-indigo-900 outline-none hover:bg-indigo-100 ${FOCUS_RING}`}
            >
              {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5 translate-x-0.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs tabular-nums text-slate-500">
                {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
              </p>
            </div>
          </div>
        </>
      )}
      {media.transcript && (
        // Stała etykieta + aria-pressed (druga runda code review, punkt 6): "Pokaż obraz"/"Pokaż transkrypcję" z
        // aria-expanded brzmiało niejednoznacznie po rozwinięciu ("Pokaż obraz, rozwinięty") - to przycisk-przełącznik
        // widoku (dwa stany, nic więcej się nie "rozwija"), nie ujawnianie treści.
        <button
          type="button"
          onClick={onToggleTranscript}
          aria-pressed={transcriptOpen}
          className={`mt-2 min-h-[44px] shrink-0 text-sm font-medium text-indigo-700 underline outline-none hover:text-indigo-900 ${FOCUS_RING}`}
        >
          Transkrypcja
        </button>
      )}
    </div>
  );
}
