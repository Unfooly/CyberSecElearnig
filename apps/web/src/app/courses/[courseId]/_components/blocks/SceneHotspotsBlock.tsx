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
import ExploreFooter from './ExploreFooter';

type AnyHotspot = SceneHotspot | InnerSceneHotspot;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700';

// Scena z punktami: ilustracja (tylko <img>, nigdy inline SVG - D-051) z klikalnymi prostokątami w % obrazu - JEDYNA
// interakcja (feedback z produkcji po PR #32: usunięta lista przycisków-chipów pod obrazem). Każdy hotspot jest
// niewidocznym <button> nałożonym na obraz, w pełni dostępny: aria-label z tytułu (+ stan "obejrzane"/"drzwi
// zablokowane"), widoczny focus-ring (FOCUS_RING) - klawiatura i czytnik ekranu działają WYŁĄCZNIE przez te punkty,
// bez osobnej listy. Licznik "Obejrzano X z Y" (ExploreFooter) jest nad obrazem, mały.
//
// Karta hotspotu i media otwierają się jako NAKŁADKA NA SCENIE, NA obrazie (nie zamiast niego): position absolute;
// inset:0 ZAWSZE w obrębie kontenera obrazu (nigdy fixed względem viewportu - inaczej na mobile nakładka zasłoniłaby
// też licznik "Obejrzano X z Y" NAD obrazem, poza kontenerem sceny), tło rgba(43,36,64,.55) (kolor `ink` z palety
// scen) lekko przyciemnia obraz WIDOCZNY dookoła karty, wyśrodkowana, przewijana w środku, gdy treść nie mieści się
// w karcie (feedback z produkcji po PR #32: wcześniej karta na h-full/w-full całkowicie zasłaniała obraz). Karta to
// max 80% szerokości/wysokości sceny na desktopie, pełna scena (100%, nie pełny EKRAN - kontener obrazu, nie
// viewport) na mobile (<640px). Zagnieżdżona
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

  // Escape zdejmuje jeden poziom nakładki - ten sam handler co przycisk "Wróć".
  useEffect(() => {
    if (!activeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') goBack();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, nestedActiveId]);

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
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      <p className="mb-2 text-sm text-slate-600">Wybierz elementy sceny, aby dowiedzieć się więcej.</p>
      <ExploreFooter done={doneCount} total={required.length} noun="elementów" review={review} className="mb-2 text-xs text-slate-500" />

      {imageUrl && !imageFailed && (
        <div className="relative overflow-hidden rounded border border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
          <img
            src={imageUrl}
            alt={block.imageAlt ?? ''}
            referrerPolicy="no-referrer"
            aria-hidden={activeId ? true : undefined}
            className="block w-full"
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
                // poleganie na aria-modal czytnika), bez pełnego focus trapu w nakładce - jak CourseRewardModal.tsx.
                aria-disabled={blocked}
                aria-hidden={activeId ? true : undefined}
                title={blocked ? `Zbierz najpierw dowody: ${doneCount}/${required.length}` : undefined}
                tabIndex={activeId ? -1 : undefined}
                onClick={(event) => handleHotspotClick(hotspot, event.currentTarget)}
                style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
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
              {/* Nakładka NA scenie, nie zamiast niej: na desktopie karta to najwyżej 80% kontenera (obraz widoczny i
                  lekko przyciemniony dookoła), przewijana w środku, gdy treść nie mieści się w 80%. Na telefonie
                  (<640px, sm:) karta zajmuje cały ekran - feedback z produkcji (`feat/scene-overlay-fix`). */}
              <div className="flex h-full w-full flex-col overflow-y-auto bg-white p-4 shadow-xl sm:h-auto sm:max-h-[80%] sm:w-auto sm:max-w-[80%] sm:rounded sm:p-4">
                <h3 id={overlayTitleId} ref={headingRef} tabIndex={-1} className="mb-2 text-sm font-semibold text-slate-900 outline-none">
                  {current.label}
                </h3>

                <HotspotDetailBody
                  hotspot={current}
                  contentBase={contentBase}
                  listened={listenedIds.includes(current.id)}
                  transcriptOpen={transcriptOpen}
                  transcriptId={transcriptId}
                  onToggleTranscript={() => setTranscriptOpen((open) => !open)}
                  onEnded={() => setListenedIds((list) => (list.includes(current.id) ? list : [...list, current.id]))}
                  visited={visited}
                  interacted={interacted}
                  nestedOverlayOpen={!!nestedActiveId}
                  onPickNested={openNested}
                />

                <div className="mt-4 flex flex-wrap gap-2">
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
          )}
        </div>
      )}
    </div>
  );
}

// Treść (tekst + media) współdzielona przez kartę zewnętrznego hotspotu i kartę hotspotu wewnątrz zagnieżdżonej sceny -
// obie zachowują się identycznie poza tym, że wewnętrzna nigdy nie ma media.kind:'scene' (typ to wymusza, więc ta
// gałąź po prostu nie występuje dla InnerSceneHotspot). Przycisk dowodu i "Wróć" renderuje RODZIC (SceneHotspotsBlock),
// nie ten komponent - "pod spodem dwa przyciski" jest wspólne dla wszystkich poziomów nakładki, nie część "treści".
function HotspotDetailBody({
  hotspot,
  contentBase,
  listened,
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
  listened: boolean;
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
  return (
    <>
      {media?.kind !== 'audio' && hotspot.content && <p className="whitespace-pre-line text-slate-800">{hotspot.content}</p>}

      {media?.kind === 'image' && <ImageMedia contentBase={contentBase} media={media} />}

      {media?.kind === 'document' && <DocumentMedia media={media} />}

      {media?.kind === 'audio' && (
        <AudioMedia
          // key: wymuszony remount (nie tylko re-render tej samej instancji) przy przejściu na INNY hotspot audio -
          // stan (playing/currentTime) i autoodtwarzanie przy otwarciu mają zawsze dotyczyć aktualnego hotspotu, nie
          // resztek po poprzednim. Dziś to i tak zawsze prawda strukturalnie (przejście między dwoma hotspotami audio
          // idzie zawsze przez stan bez audio - zamknięcie nakładki albo widok sceny zagnieżdżonej), ale `key` nie
          // polega na tym inwariancie (D-073: "to inwariant UI, nie coś, na czym stan POWINIEN polegać").
          key={hotspot.id}
          contentBase={contentBase}
          media={media}
          transcriptOpen={transcriptOpen}
          transcriptId={transcriptId}
          onToggleTranscript={onToggleTranscript}
          onEnded={onEnded}
        />
      )}

      {media?.kind === 'audio' && listened && hotspot.content && <p className="mt-3 whitespace-pre-line text-slate-800">{hotspot.content}</p>}

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
// nestedActiveId), nie nową nakładkę.
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
  if (!url) return null;
  return (
    <div className="relative mt-3 overflow-hidden rounded border border-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL */}
      <img src={url} alt={scene.imageAlt} referrerPolicy="no-referrer" aria-hidden={overlayOpen ? true : undefined} className="block w-full" />
      {scene.hotspots.map((hotspot) => {
        const seen = visited.includes(hotspot.id);
        return (
          <button
            key={hotspot.id}
            type="button"
            aria-label={`${hotspot.label}${seen ? ' (obejrzane)' : ''}`}
            aria-hidden={overlayOpen ? true : undefined}
            tabIndex={overlayOpen ? -1 : undefined}
            onClick={() => onPick(hotspot.id)}
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
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
  );
}

function ImageMedia({ contentBase, media }: { contentBase: string; media: HotspotMedia | InnerHotspotMedia }) {
  const url = contentAssetUrl(contentBase, media.src, 'image');
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL, powiększenie wprost w karcie (bez osobnej nakładki)
    <img src={url} alt={media.alt ?? ''} referrerPolicy="no-referrer" className="mt-3 max-h-[45vh] w-full rounded border border-slate-200 object-contain" />
  );
}

function DocumentMedia({ media }: { media: HotspotMedia | InnerHotspotMedia }) {
  return (
    <div className="mt-3">
      {media.title && <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{media.title}</h4>}
      <pre className="max-h-[35vh] overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-3 font-mono text-sm leading-relaxed text-slate-100">
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
// błędzie (inaczej niż NarrationPlayer.tsx, na życzenie: to poboczny efekt dźwiękowy w karcie, nie główna narracja).
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

  return (
    <div className="mt-3">
      {url && (
        <>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
            <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="w-full rounded border border-slate-200 object-contain" />
          )}
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
          <div className="mt-3 flex items-center gap-3">
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
        <>
          <button
            type="button"
            onClick={onToggleTranscript}
            aria-expanded={transcriptOpen}
            aria-controls={transcriptId}
            className={`mt-2 min-h-[44px] text-sm font-medium text-indigo-700 underline outline-none hover:text-indigo-900 ${FOCUS_RING}`}
          >
            {transcriptOpen ? 'Ukryj transkrypcję' : 'Pokaż transkrypcję'}
          </button>
          <p id={transcriptId} hidden={!transcriptOpen} className="mt-2 whitespace-pre-line rounded bg-white p-2 text-sm text-slate-700 ring-1 ring-slate-200">
            {media.transcript}
          </p>
        </>
      )}
    </div>
  );
}
