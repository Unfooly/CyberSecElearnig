'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, DoorOpen, X } from 'lucide-react';
import type { ContentBlock, HotspotMedia, InnerHotspotMedia, InnerSceneHotspot, NestedScene, SceneHotspot } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { flattenHotspots } from '@/lib/flatten-hotspots';
import { useNotes, NoteKindIcon } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import ExploreFooter from './ExploreFooter';

type AnyHotspot = SceneHotspot | InnerSceneHotspot;

// Nakładka pełnoekranowa (image/document, B-086/D-071): mobile pełny ekran, od sm w górę max-width/max-height 90vw/90vh
// wyśrodkowane. Ten sam wzorzec dialogu co CourseRewardModal.tsx (role=dialog, aria-modal, Escape zamyka) - bez pełnego
// focus trapu (jak tam), bo jedyny interaktywny element w środku to przycisk zamknięcia. Fokus po zamknięciu wraca do
// przycisku, który otworzył nakładkę (onClose w SceneHotspotsBlock go oddaje).
function MediaOverlay({
  onClose,
  ariaLabel,
  titleId,
  children,
}: {
  onClose: () => void;
  ariaLabel?: string;
  titleId?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full flex-col overflow-auto bg-white sm:h-auto sm:max-h-[90vh] sm:w-auto sm:max-w-[90vw] sm:rounded-lg sm:shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij podgląd"
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

// Scena z punktami: ilustracja (tylko <img>, nigdy inline SVG - D-051) z klikalnymi prostokątami w % obrazu. Punkty na obrazie są
// niewidoczne do najechania (lekki puls podpowiada je do pierwszego kliknięcia); te same punkty są listą przycisków pod obrazem: to główna
// ścieżka dla klawiatury, czytników ekranu i dotyku (małe prostokąty na 390 px trudno trafić), więc nakładki są aria-hidden i poza kolejnością
// Tab. Kliknięty punkt otwiera kartę; punkt-dowód ma "Dodaj do notatnika". Ukończenie po wymaganych punktach (reszta to "smaczki").
// Media karty (B-086/D-071): hotspot może OBOK content mieć media (image/audio/document/scene) - image/document w
// pełnoekranowej nakładce, audio z własnym odtwarzaczem, scene to zagnieżdżona mini-scena (własny obraz + własne
// hotspoty, zawsze DOKŁADNIE jeden poziom - jej hotspoty nie mają już własnego media.kind:'scene'). Required/ukończenie
// bloku liczone na SPŁASZCZONEJ liście (zewnętrzne + wewnętrzne, flattenHotspots - ta sama funkcja co serwer, D-071) -
// dowody z zagnieżdżonej sceny LICZĄ SIĘ do bloku. Dla hotspotu Z MEDIA (dowolny poziom, oprócz samej "bramki" scene)
// dowód zalicza się OD RAZU przy otwarciu karty (nie po odsłuchaniu/obejrzeniu) - "otwarcie" jest tu dowodem samym w
// sobie, inaczej niż zwykły tekstowy hotspot, który wciąż wymaga świadomego "Dodaj do notatnika". Dla audio: insight
// (content bloku) odsłania się dopiero po onEnded, ale transkrypcja jest dostępna od razu pod przyciskiem "Pokaż
// transkrypcję" - użytkownik bez dźwięku nie może czekać na zdarzenie, które nigdy nie nadejdzie.
// action "next" (drzwi): kolejny commit. Odpowiedź dla serwera: { visited: [id...], noted: [id...] }.
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
  // Id hotspotu WEWNĄTRZ zagnieżdżonej sceny bieżącego `active` (media.kind:'scene') - resetuje się przy zmianie activeId.
  const [nestedActiveId, setNestedActiveId] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // Audio: id hotspotów (dowolnego poziomu), których nagranie zostało odsłuchane do końca (onEnded) - odsłania insight (content).
  const [listenedIds, setListenedIds] = useState<string[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [overlay, setOverlay] = useState<{ hotspot: AnyHotspot; kind: 'image' | 'document' } | null>(null);
  const overlayTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageUrl = contentAssetUrl(contentBase, block.image, 'image');
  const active = hotspots.find((hotspot) => hotspot.id === activeId) ?? null;
  const nestedScene = active?.media?.kind === 'scene' ? active.media.scene : undefined;
  const activeInner = nestedScene?.hotspots.find((hotspot) => hotspot.id === nestedActiveId) ?? null;
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

  // Zmiana aktywnego elementu (zewnętrznego albo wewnątrz zagnieżdżonej sceny): transkrypcja się zwija, nakładka zamyka.
  useEffect(() => {
    setTranscriptOpen(false);
    setOverlay(null);
  }, [activeId, nestedActiveId]);

  // Zmiana zewnętrznego hotspotu zeruje wybór wewnątrz JEGO zagnieżdżonej sceny (poprzedni wybór nie ma tu sensu).
  useEffect(() => {
    setNestedActiveId(null);
  }, [activeId]);

  function markVisited(id: string) {
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
    const hotspot = flat.find((candidate) => candidate.id === id);
    // Media (dowolny poziom, oprócz samej "bramki" scene) zalicza dowód OD RAZU przy otwarciu karty: "otwarcie" jest
    // dowodem, w przeciwieństwie do zwykłego tekstowego hotspotu (addToNotepad niżej no-opuje, gdy nie jest dowodem).
    if (hotspot?.media && hotspot.media.kind !== 'scene') addToNotepad(id);
  }

  function open(id: string) {
    setInteracted(true);
    setActiveId(id);
    markVisited(id);
  }

  // Drzwi (action:'next'): nigdy nie otwierają kartę - gotowe (ready) kończą blok od razu, jak przycisk "Dalej" w
  // pasku; przed tym klik nic nie robi (przycisk jest wtedy aria-disabled, ale klawiatura/dotyk i tak trafiają tutaj).
  function clickDoor() {
    if (!review && ready) onSubmit({ visited, noted });
  }

  function handleHotspotClick(hotspot: SceneHotspot) {
    if (hotspot.action === 'next') clickDoor();
    else open(hotspot.id);
  }

  function openNested(id: string) {
    setNestedActiveId(id);
    markVisited(id);
  }

  function addToNotepad(id: string) {
    const hotspot = flat.find((candidate) => candidate.id === id);
    if (!hotspot?.evidence || !hotspot.note || noted.includes(id) || review || !block.id) return;
    setNoted((current) => [...current, id]);
    addNote({ blockId: block.id, text: hotspot.note.text, kind: hotspot.note.kind });
    evidence.addPending(`${block.id}.${id}`);
    mascot.react('evidence');
  }

  function openOverlay(hotspot: AnyHotspot, kind: 'image' | 'document', trigger: HTMLButtonElement | null) {
    overlayTriggerRef.current = trigger;
    setOverlay({ hotspot, kind });
  }

  function closeOverlay() {
    setOverlay(null);
    overlayTriggerRef.current?.focus();
  }

  const isNoted = (id: string) => noted.includes(id);
  const overlayImageUrl = overlay?.kind === 'image' && overlay.hotspot.media?.kind === 'image' ? contentAssetUrl(contentBase, overlay.hotspot.media.src, 'image') : null;

  return (
    <div>
      {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
      <p className="mb-3 text-sm text-slate-600">Wybierz elementy sceny, aby dowiedzieć się więcej.</p>

      {imageUrl && !imageFailed && (
        <div className="relative mb-4 overflow-hidden rounded border border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
          <img
            src={imageUrl}
            alt={block.imageAlt ?? ''}
            referrerPolicy="no-referrer"
            className="block w-full"
            onError={() => setImageFailed(true)}
          />
          {hotspots.map((hotspot) => {
            const seen = visited.includes(hotspot.id);
            const isDoor = hotspot.action === 'next';
            return (
              <button
                key={hotspot.id}
                type="button"
                data-testid={`hotspot-overlay-${hotspot.id}`}
                data-state={isDoor ? (ready ? 'ready' : 'blocked') : seen ? 'discovered' : interacted ? 'hidden' : 'hint'}
                // Nakładka tylko dla myszy i dotyku; klawiatura i czytniki używają listy poniżej (jeden cel na punkt).
                aria-hidden="true"
                tabIndex={-1}
                // Natywne disabled tu jest OK (w odróżnieniu od odpowiednika na liście niżej, który celowo używa
                // aria-disabled, żeby zostać skupialny/ogłaszany) - ten przycisk i tak jest już poza kolejnością Tab
                // (tabIndex={-1}, aria-hidden) i niewidoczny dla czytników ekranu, więc nie ma czego "zgubić".
                disabled={isDoor && !ready}
                onClick={() => handleHotspotClick(hotspot)}
                style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
                className={`absolute min-h-[24px] min-w-[24px] rounded border-2 transition-colors ${
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
                {!isDoor && seen && (
                  <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
                    <Check aria-hidden="true" className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <ul aria-label="Elementy sceny" className="flex flex-wrap gap-2">
        {hotspots.map((hotspot) =>
          hotspot.action === 'next' ? (
            <li key={hotspot.id}>
              {/* Drzwi: gotowe (ready) kończą blok od razu, jak "Dalej" w pasku (który jest wtedy ukryty - hideForward
                  w CoursePlayer.tsx). Nieaktywne zostaje SKUPIALNE (aria-disabled, nie disabled) - czytnik ekranu ma
                  usłyszeć DLACZEGO, zamiast po prostu pominąć przycisk. */}
              <button
                type="button"
                aria-disabled={!ready}
                aria-label={ready ? undefined : `${hotspot.label}: zbierz najpierw dowody (${doneCount}/${required.length})`}
                title={ready ? undefined : `Zbierz najpierw dowody: ${doneCount}/${required.length}`}
                onClick={() => handleHotspotClick(hotspot)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded border px-3 py-2 text-sm font-medium ${
                  ready
                    ? 'border-amber-600 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <DoorOpen aria-hidden="true" className="h-4 w-4" />
                {hotspot.label}
              </button>
            </li>
          ) : (
            <li key={hotspot.id}>
              <button
                type="button"
                aria-pressed={activeId === hotspot.id}
                onClick={() => open(hotspot.id)}
                className={`min-h-[44px] rounded border px-3 py-2 text-sm font-medium ${
                  activeId === hotspot.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                {hotspot.label}
                {visited.includes(hotspot.id) && <span className="sr-only"> (obejrzane)</span>}
                {visited.includes(hotspot.id) && <span aria-hidden="true"> ✓</span>}
              </button>
            </li>
          ),
        )}
      </ul>

      <div aria-live="polite" className="mt-4 min-h-[3rem]">
        {active && (
          <article data-testid="hotspot-card" aria-label={active.label} className="rounded bg-slate-50 p-3 ring-1 ring-slate-200">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">{active.label}</h3>

            <HotspotDetailBody
              hotspot={active}
              contentBase={contentBase}
              listened={listenedIds.includes(active.id)}
              transcriptOpen={transcriptOpen}
              transcriptId={transcriptId}
              onToggleTranscript={() => setTranscriptOpen((open) => !open)}
              onEnded={() => setListenedIds((current) => (current.includes(active.id) ? current : [...current, active.id]))}
              onOpenOverlay={(kind, trigger) => openOverlay(active, kind, trigger)}
              noted={isNoted(active.id)}
              onAddToNotepad={() => addToNotepad(active.id)}
              review={review}
            />

            {nestedScene && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{nestedScene.imageAlt}</p>
                <NestedSceneImage contentBase={contentBase} scene={nestedScene} visited={visited} interacted={interacted} onPick={openNested} />
                <ul aria-label={`Elementy: ${nestedScene.imageAlt}`} className="flex flex-wrap gap-2">
                  {nestedScene.hotspots.map((hotspot) => (
                    <li key={hotspot.id}>
                      <button
                        type="button"
                        aria-pressed={nestedActiveId === hotspot.id}
                        onClick={() => openNested(hotspot.id)}
                        className={`min-h-[44px] rounded border px-3 py-2 text-sm font-medium ${
                          nestedActiveId === hotspot.id
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        {hotspot.label}
                        {visited.includes(hotspot.id) && <span className="sr-only"> (obejrzane)</span>}
                        {visited.includes(hotspot.id) && <span aria-hidden="true"> ✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>

                {activeInner && (
                  <article className="mt-3 rounded bg-white p-3 ring-1 ring-slate-200" aria-label={activeInner.label}>
                    <h4 className="mb-1 text-sm font-semibold text-slate-900">{activeInner.label}</h4>
                    <HotspotDetailBody
                      hotspot={activeInner}
                      contentBase={contentBase}
                      listened={listenedIds.includes(activeInner.id)}
                      transcriptOpen={transcriptOpen}
                      transcriptId={transcriptId}
                      onToggleTranscript={() => setTranscriptOpen((open) => !open)}
                      onEnded={() => setListenedIds((current) => (current.includes(activeInner.id) ? current : [...current, activeInner.id]))}
                      onOpenOverlay={(kind, trigger) => openOverlay(activeInner, kind, trigger)}
                      noted={isNoted(activeInner.id)}
                      onAddToNotepad={() => addToNotepad(activeInner.id)}
                      review={review}
                    />
                  </article>
                )}
              </div>
            )}
          </article>
        )}
      </div>

      {overlay?.kind === 'image' && overlayImageUrl && overlay.hotspot.media?.kind === 'image' && (
        <MediaOverlay onClose={closeOverlay} ariaLabel={overlay.hotspot.media.alt || overlay.hotspot.label}>
          {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL, nakładka pełnoekranowa */}
          <img
            src={overlayImageUrl}
            alt={overlay.hotspot.media.alt ?? ''}
            referrerPolicy="no-referrer"
            className="m-auto max-h-full max-w-full object-contain"
          />
        </MediaOverlay>
      )}

      {overlay?.kind === 'document' && overlay.hotspot.media?.kind === 'document' && (
        <MediaOverlay onClose={closeOverlay} titleId={overlayTitleId}>
          <div className="flex h-full flex-col p-4 sm:p-6">
            <h2 id={overlayTitleId} className="mb-3 pr-10 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {overlay.hotspot.media.title}
            </h2>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-100">
              {overlay.hotspot.media.lines?.join('\n')}
            </pre>
          </div>
        </MediaOverlay>
      )}

      <ExploreFooter done={doneCount} total={required.length} noun="elementów" review={review} />
    </div>
  );
}

// Treść (content + media + wskaźnik dowodu) współdzielona przez kartę zewnętrznego hotspotu i kartę hotspotu wewnątrz
// zagnieżdżonej sceny - obie zachowują się identycznie poza tym, że wewnętrzna nigdy nie ma media.kind:'scene' (typ to
// wymusza, więc gałąź "scene" tu w ogóle nie występuje).
function HotspotDetailBody({
  hotspot,
  contentBase,
  listened,
  transcriptOpen,
  transcriptId,
  onToggleTranscript,
  onEnded,
  onOpenOverlay,
  noted,
  onAddToNotepad,
  review,
}: {
  hotspot: AnyHotspot;
  contentBase: string;
  listened: boolean;
  transcriptOpen: boolean;
  transcriptId: string;
  onToggleTranscript: () => void;
  onEnded: () => void;
  onOpenOverlay: (kind: 'image' | 'document', trigger: HTMLButtonElement | null) => void;
  noted: boolean;
  onAddToNotepad: () => void;
  review: boolean;
}) {
  const media = hotspot.media;
  return (
    <>
      {media?.kind !== 'audio' && hotspot.content && <p className="whitespace-pre-line text-slate-800">{hotspot.content}</p>}

      {media?.kind === 'image' && (
        <ImagePreview contentBase={contentBase} media={media} onOpen={(trigger) => onOpenOverlay('image', trigger)} />
      )}

      {media?.kind === 'document' && <DocumentPreview media={media} onOpen={(trigger) => onOpenOverlay('document', trigger)} />}

      {media?.kind === 'audio' && (
        <AudioMedia
          contentBase={contentBase}
          media={media}
          transcriptOpen={transcriptOpen}
          transcriptId={transcriptId}
          onToggleTranscript={onToggleTranscript}
          onEnded={onEnded}
        />
      )}

      {media?.kind === 'audio' && listened && hotspot.content && <p className="mt-3 whitespace-pre-line text-slate-800">{hotspot.content}</p>}

      {hotspot.evidence && hotspot.note && !review && (
        <div className="mt-3">
          {noted ? (
            <p className="inline-flex items-center gap-2 text-sm font-medium text-green-700">
              <NoteKindIcon kind={hotspot.note.kind} />
              Dodano do notatnika
            </p>
          ) : (
            <button
              type="button"
              onClick={onAddToNotepad}
              className="min-h-[44px] rounded border border-indigo-600 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
            >
              Dodaj do notatnika
            </button>
          )}
        </div>
      )}
    </>
  );
}

// Obraz zagnieżdżonej sceny z klikalnymi prostokątami - jak główna ilustracja bloku, ale bez własnego stanu "imageFailed"
// (błąd wczytania po prostu nic nie pokazuje - to smaczek w karcie, nie osobny blok).
function NestedSceneImage({
  contentBase,
  scene,
  visited,
  interacted,
  onPick,
}: {
  contentBase: string;
  scene: NestedScene;
  visited: string[];
  interacted: boolean;
  onPick: (id: string) => void;
}) {
  const url = contentAssetUrl(contentBase, scene.image, 'image');
  if (!url) return null;
  return (
    <div className="relative mb-3 overflow-hidden rounded border border-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL */}
      <img src={url} alt={scene.imageAlt} referrerPolicy="no-referrer" className="block w-full" />
      {scene.hotspots.map((hotspot) => {
        const seen = visited.includes(hotspot.id);
        return (
          <button
            key={hotspot.id}
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => onPick(hotspot.id)}
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
            className={`absolute min-h-[24px] min-w-[24px] rounded border-2 transition-colors hover:border-indigo-600 hover:bg-indigo-500/20 ${
              seen ? 'border-green-600 bg-green-500/[0.07]' : interacted ? 'border-transparent' : 'border-indigo-400/70 bg-indigo-500/10 motion-safe:animate-pulse'
            }`}
          />
        );
      })}
    </div>
  );
}

function ImagePreview({
  contentBase,
  media,
  onOpen,
}: {
  contentBase: string;
  media: HotspotMedia | InnerHotspotMedia;
  onOpen: (trigger: HTMLButtonElement | null) => void;
}) {
  const url = contentAssetUrl(contentBase, media.src, 'image');
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className="mt-3 block overflow-hidden rounded border border-slate-300 hover:border-indigo-500"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL, podgląd przed powiększeniem */}
      <img src={url} alt="" referrerPolicy="no-referrer" className="max-h-48 w-full object-cover" />
      <span className="block bg-slate-900/80 px-2 py-1 text-xs font-medium text-white">Powiększ{media.alt ? `: ${media.alt}` : ''}</span>
    </button>
  );
}

function DocumentPreview({ media, onOpen }: { media: HotspotMedia | InnerHotspotMedia; onOpen: (trigger: HTMLButtonElement | null) => void }) {
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className="mt-3 min-h-[44px] rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
    >
      Zobacz dokument{media.title ? `: ${media.title}` : ''}
    </button>
  );
}

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
  return (
    <div className="mt-3">
      {url && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- transkrypcja jest obok (przycisk niżej), nie <track>
        <audio controls preload="none" src={url} onEnded={onEnded} className="w-full">
          Twoja przeglądarka nie obsługuje odtwarzania dźwięku.
        </audio>
      )}
      {media.transcript && (
        <>
          <button
            type="button"
            onClick={onToggleTranscript}
            aria-expanded={transcriptOpen}
            aria-controls={transcriptId}
            className="mt-2 min-h-[44px] text-sm font-medium text-indigo-700 underline hover:text-indigo-900"
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
