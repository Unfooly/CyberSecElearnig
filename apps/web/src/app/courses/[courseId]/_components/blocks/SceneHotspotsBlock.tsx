'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, Check, DoorOpen, Pause, Play } from 'lucide-react';
import type { ContentBlock, HotspotMedia, InnerHotspotMedia, InnerSceneHotspot, NestedScene, SceneHotspot } from '@/lib/courses-types';
import { contentAssetUrl, withStaticFragment } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { flattenHotspots } from '@/lib/flatten-hotspots';
import { sceneZoom, sceneZoomStyle } from '@/lib/scene-zoom';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { PORTRAIT_THRESHOLD } from '@/lib/use-portrait-container';
import { flyEvidence } from '@/lib/motion';
import { useNotes, NoteKindIcon } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteHint, useHints } from '../player/hints';
import { useOverlayLayer } from '../player/overlay-stack';
import ScenePanContainer from '../player/ScenePanContainer';
import { vibrate } from '@/lib/vibrate';
import ExploreFooter from './ExploreFooter';
import PopupsEasterEgg, { type PopupsHandle } from './PopupsEasterEgg';

type AnyHotspot = SceneHotspot | InnerSceneHotspot;
type Phase = 'in' | 'open' | 'out';
type CameraStyle = { transformOrigin: string; transform: string } | null;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700';
// Przyciemnienie sceny pod zbliżeniem (D-102): ink 35% + rozmycie 3 px - pulpit i okienka easter egga leżą na tej samej nakładce.
const ZOOM_DIM = 'bg-ink/35 backdrop-blur-[3px]';
// Pierścień fokusu przycisków nakładki dwukolorowy (D-101): ciemny obrys na zewnątrz i biały pierścień przy krawędzi - widoczny
// niezależnie od tego, co leży pod przyciskiem (przyciemniona scena, jasny fragment grafiki, ciemny przycisk).
const LIGHT_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:ring-2 focus-visible:ring-white';
// Ruch kamery (D-086): przybliżenie 450 ms, oddalenie 350 ms, krzywa "ease-out-soft"; grafika zbliżenia pojawia się crossfade'em.
const ZOOM_IN_MS = 450;
const ZOOM_OUT_MS = 350;
const EASE_OUT_SOFT = 'cubic-bezier(.2,.8,.2,1)';
const TOAST_MS = 2500;
export const NOT_EVIDENCE_TOAST = 'To nie jest dowód w tej sprawie.';

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
// osiągną z-index 30 nakładki zbliżenia (`z-30` niżej) - ale nic w tym pliku tego nie wymusza, więc obcinamy jawnie.
export function hotspotStackZIndex<T extends { id: string; width: number; height: number }>(all: T[]): Map<string, number> {
  const byAreaDesc = [...all].sort((a, b) => b.width * b.height - a.width * a.height);
  return new Map(byAreaDesc.map((hotspot, index) => [hotspot.id, Math.min(index + 1, 29)]));
}

// Startowa pozycja panoramy (feat/player-portrait, ScenePanContainer initialPanX) - centroid (średnia środków x%)
// hotspotów DANEJ sceny, nie środek obrazu, żeby coś interaktywnego było widoczne bez panowania od razu. 0..1
// (fraction szerokości), nie piksele - ScenePanContainer sam przelicza na scrollLeft po zmierzeniu WŁASNEGO
// scrollWidth/clientWidth. Scena bez hotspotów (nie powinna się zdarzyć w treści, ale defensywnie) -> 0.5 (środek).
export function computeHotspotCentroid(hotspots: readonly { x: number; width: number }[]): number {
  if (hotspots.length === 0) return 0.5;
  const centersPercent = hotspots.map((hotspot) => hotspot.x + hotspot.width / 2);
  const averagePercent = centersPercent.reduce((sum, value) => sum + value, 0) / centersPercent.length;
  return Math.min(1, Math.max(0, averagePercent / 100));
}

/** Transform kamery z prostokątów: przedmiot (przycisk hotspotu), pudełko obrazu i widoczny obszar. */
function cameraFor(trigger: HTMLElement | null, box: HTMLElement | null, view: HTMLElement | null): CameraStyle {
  if (!trigger || !box || !view) return null;
  return sceneZoomStyle(sceneZoom(trigger.getBoundingClientRect(), box.getBoundingClientRect(), view.getBoundingClientRect()));
}

// Preferencja w chwili kliknięcia: stan z usePrefersReducedMotion ustawia się dopiero w efekcie po zamontowaniu, więc klik tuż po
// hydratacji (layout-check, szybki użytkownik) widziałby jeszcze `false` i uruchomił kamerę mimo reduced-motion.
function reducedMotionNow(state: boolean): boolean {
  return state || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
}

function cameraTransition(reducedMotion: boolean, phase: Phase | null): string | undefined {
  if (reducedMotion) return undefined;
  return `transform ${phase === 'out' ? ZOOM_OUT_MS : ZOOM_IN_MS}ms ${EASE_OUT_SOFT}`;
}

// Scena z przedmiotami (SCENE_HOTSPOTS, D-086 "nowa interakcja przedmiotów"): ilustracja (tylko <img>, nigdy inline SVG - D-051) z
// klikalnymi prostokątami w % obrazu. Każdy przedmiot to <button> z aria-label i widocznym focusem. Klik w przedmiot:
//   1. "kamera" przybliża scenę do przedmiotu (scale + translate z sceneZoom - przedmiot ~70% widocznego obszaru, 450 ms); bez
//      reszta sceny przyciemniona (ink 35%) i rozmyta (3 px, D-102); ramki punktów i podpowiedź panoramy pod zbliżeniem są ukryte
//      (data-zoom-open);
//   2. crossfade do grafiki zbliżenia (media.image / media.src; przezroczyste tło - D-101) na środku, max 88% sceny - bez karty i bez
//      bloków tekstu, tylko cień po kształcie (.zoom-shadow, drop-shadow);
//   3. na dole "Zabierz" (accent) i "Odłóż" (jasny ghost). Esc / klik w tło = Odłóż; wyjście - odwrotny zoom 350 ms.
// "Zabierz" przy dowodzie dopisuje notatkę do notatnika (tekst notatki jest TYLKO w notatniku) i odkłada; przy przedmiocie bez dowodu -
// potrząśnięcie i toast NOT_EVIDENCE_TOAST, bez kary. Już zabrany - tylko "Odłóż" i znacznik "W notatniku". Nagranie (poczta głosowa):
// play/pauza pod grafiką (i transkrypcja jako alternatywa tekstowa). Scena zagnieżdżona (monitor -> pulpit): przybliżenie na monitor i
// przejście do sceny zagnieżdżonej z ikoną "Wróć" - jej przedmioty (okna na ekranie, D-104) otwierają się BEZ ruchu kamery, od razu nad
// przyciemnionym pulpitem (max 94% sceny), okienka easter egga bez przyciemnienia. Drzwi (action:'next') - bez
// zoomu, klik kończy blok jak dotąd. reduced-motion: bez ruchu kamery, grafika od razu. A11y: role=dialog, aria-label = nazwa przedmiotu,
// focus trap w nakładce, po zamknięciu fokus wraca na przedmiot.
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
  const initialPanX = computeHotspotCentroid(hotspots);
  const { addNote, addDistinction, distinctions } = useNotes();
  // Otwarte okienka easter egga (D-100): Esc zamyka górne okienko, tło i „Odłóż” nie zamykają niczego, dopóki są otwarte.
  const popupsRef = useRef<PopupsHandle | null>(null);
  const evidence = useEvidence();
  const hints = useHints();
  const reducedMotion = usePrefersReducedMotion();
  // Telefon w pionie (widoczny obszar sceny < 0.8, jak D-098): zbliżenia z `imagePortrait` pokazują wariant pionowy (D-104).
  const [portraitStage, setPortraitStage] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  const [noted, setNoted] = useState<string[]>([]);
  const [interacted, setInteracted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // Proporcja obrazu z onLoad (albo z cache zaraz po zamontowaniu - React 18 nie odtwarza `load` dla obrazu z cache sprzed hydratacji,
  // React #15446); domyślne 16/10 tylko na czas ładowania.
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Poziom 1: przedmiot sceny głównej; poziom 2: przedmiot WEWNĄTRZ sceny zagnieżdżonej (media.kind:'scene') - maks. 2 poziomy.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [camera, setCamera] = useState<CameraStyle>(null);
  const [nestedActiveId, setNestedActiveId] = useState<string | null>(null);
  const [nestedPhase, setNestedPhase] = useState<Phase | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nestedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<number[]>([]);
  // Generacja przejść: każde otwarcie/zamknięcie ją podbija, a zaplanowane przejście fazy (koniec animacji) wykonuje się tylko, gdy
  // generacja się nie zmieniła - stary timer nie "dokończy" zbliżenia, które w międzyczasie zamknięto albo otwarto od nowa.
  const generation = useRef(0);
  // Faza w refie dla handlerów (Esc przez overlay-stack, podwójne kliknięcia w tej samej klatce).
  const phaseRef = useRef<Phase | null>(null);
  const nestedPhaseRef = useRef<Phase | null>(null);
  phaseRef.current = phase;
  nestedPhaseRef.current = nestedPhase;
  const imageUrl = withStaticFragment(contentAssetUrl(contentBase, block.image, 'image'), reducedMotion);
  const active = hotspots.find((hotspot) => hotspot.id === activeId) ?? null;
  const nestedScene = active?.media?.kind === 'scene' ? active.media.scene : undefined;
  const activeInner = nestedScene?.hotspots.find((hotspot) => hotspot.id === nestedActiveId) ?? null;
  const current: AnyHotspot | null = activeInner ?? active;

  // "Drzwi" (action:'next', B-086/D-071) WYKLUCZONE z puli required: nigdy nie trafiają do `visited` same z siebie (klik od razu
  // kończy blok) - inaczej scena z SAMYMI drzwiami (np. "korytarz") nigdy nie mogłaby się ukończyć. Ta sama reguła co server-side
  // (evaluate.ts) i walidacja modułu (semantics.ts). Okienka easter egga (D-100) też poza pulą - nigdy nie są warunkiem ukończenia.
  const doorIds = new Set(hotspots.filter((hotspot) => hotspot.action === 'next').map((hotspot) => hotspot.id));
  const required = requiredItemIds(
    flat.filter((hotspot) => !doorIds.has(hotspot.id) && hotspot.media?.kind !== 'popups'),
    block.requiredHotspots,
  );
  const doneCount = required.filter((id) => visited.includes(id)).length;
  const ready = doneCount >= required.length;
  const hasDoor = doorIds.size > 0;
  useCompleteHint(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    // Z drzwiami blok NIGDY nie zgłasza gotowości przez pasek - jedynym wyjściem jest klik w drzwi (CoursePlayer.tsx chowa wtedy
    // "Dalej" paska, hideForward).
    onReady(!hasDoor && ready ? () => onSubmit({ visited, noted }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku, nie "stabilność".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visited, noted, review, hasDoor]);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) setAspectRatio(img.naturalWidth / img.naturalHeight);
  }, [imageUrl]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const measure = () => {
      const { width, height } = view.getBoundingClientRect();
      if (width > 0 && height > 0) setPortraitStage(width / height < PORTRAIT_THRESHOLD);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    return () => observer.disconnect();
    // Widok sceny (viewRef) montuje się warunkowo - dopiero z adresem obrazu i bez błędu ładowania - więc pomiar zależy od tych dwóch
    // wartości, nie od refa (usePortraitContainer mierzy element zamontowany od razu, stąd osobny pomiar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, imageFailed]);

  // Fokus: przy otwarciu (w tym samym renderze, zanim przedmiot dostanie aria-hidden - reguła axe "aria-hidden-focus") na samą
  // nakładkę, a gdy grafika jest już na miejscu - na pierwszy przycisk (Zabierz/Odłóż albo Wróć).
  // Po odłożeniu przedmiotu sceny zagnieżdżonej fokus wraca na TEN przedmiot (closeNested), nie na "Wróć" - stąd flaga.
  const returningFocus = useRef(false);
  useLayoutEffect(() => {
    if (activeId && !returningFocus.current) overlayRef.current?.focus();
  }, [activeId, nestedActiveId]);
  useEffect(() => {
    if (returningFocus.current) {
      returningFocus.current = false;
      return;
    }
    const opened = nestedActiveId ? nestedPhase === 'open' : phase === 'open';
    if (!opened) return;
    overlayRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase, nestedPhase, nestedActiveId]);

  useEffect(() => setTranscriptOpen(false), [activeId, nestedActiveId]);

  // Escape zdejmuje jeden poziom (overlay-stack - jeden nasłuch Escape w PlayerStage, LIFO).
  useOverlayLayer('hotspotCard', activeId !== null, goBack);

  function later(ms: number, fn: () => void) {
    const scheduledIn = generation.current;
    timers.current.push(
      window.setTimeout(() => {
        if (generation.current === scheduledIn) fn();
      }, ms),
    );
  }

  function markVisited(id: string) {
    setVisited((list) => (list.includes(id) ? list : [...list, id]));
  }

  function open(hotspot: SceneHotspot, trigger: HTMLButtonElement) {
    generation.current += 1;
    vibrate(10);
    setInteracted(true);
    setToast(null);
    setShake(0);
    triggerRef.current = trigger;
    setActiveId(hotspot.id);
    setNestedActiveId(null);
    setNestedPhase(null);
    // Easter egg (D-100) liczy się jako odwiedzony dopiero po zamknięciu wszystkich okienek (foundEasterEgg).
    if (hotspot.media?.kind !== 'popups') markVisited(hotspot.id);
    if (reducedMotionNow(reducedMotion)) {
      setCamera(null);
      setPhase('open');
      return;
    }
    setCamera(cameraFor(trigger, boxRef.current, viewRef.current));
    setPhase('in');
    later(ZOOM_IN_MS, () => setPhase((p) => (p === 'in' ? 'open' : p)));
  }

  function close() {
    // Już się oddala (drugi klik "Odłóż", Esc w trakcie) albo nic nie jest otwarte - drugi `finish` zamknąłby coś otwartego w międzyczasie.
    if (phaseRef.current === 'out' || phaseRef.current === null) return;
    phaseRef.current = 'out';
    generation.current += 1;
    // Na czas oddalania fokus na nakładce (przyciski znikają od razu), potem wraca na przedmiot.
    overlayRef.current?.focus();
    const trigger = triggerRef.current;
    const finish = () => {
      setActiveId(null);
      setPhase(null);
      setNestedActiveId(null);
      setNestedPhase(null);
      setToast(null);
      trigger?.focus();
    };
    setCamera(null);
    if (reducedMotionNow(reducedMotion)) finish();
    else {
      setPhase('out');
      later(ZOOM_OUT_MS, finish);
    }
  }

  function openNested(hotspot: InnerSceneHotspot, trigger: HTMLButtonElement) {
    // Pulpit jest klikalny dopiero po dojechaniu kamery na monitor i gdy żaden jego przedmiot nie jest otwarty.
    if (phaseRef.current !== 'open' || nestedPhaseRef.current !== null) return;
    // Od razu w refie - drugi klik w tej samej klatce (przed renderem) nie otworzy drugiego okna.
    nestedPhaseRef.current = 'open';
    generation.current += 1;
    returningFocus.current = false;
    vibrate(10);
    setToast(null);
    setShake(0);
    nestedTriggerRef.current = trigger;
    setNestedActiveId(hotspot.id);
    if (hotspot.media?.kind !== 'popups') markVisited(hotspot.id);
    // Scena zagnieżdżona to ekran (pulpit w ramce monitora, D-104): klik w ikonę NIE rusza kamerą - okno otwiera się od razu nad
    // pulpitem (bez przybliżenia, jak aplikacja na komputerze). Sam wjazd „w monitor” ze sceny głównej zostaje (open()).
    setNestedPhase('open');
  }

  function closeNested() {
    if (nestedPhaseRef.current === 'out' || nestedPhaseRef.current === null) return;
    nestedPhaseRef.current = 'out';
    generation.current += 1;
    const trigger = nestedTriggerRef.current;
    // Bez kamery na ekranie (D-104) - okno zamyka się od razu, fokus wraca na ikonę pulpitu.
    returningFocus.current = true;
    setNestedActiveId(null);
    setNestedPhase(null);
    setToast(null);
    trigger?.focus();
  }

  // "Odłóż" / Esc / klik w tło: zdejmuje jeden poziom. Otwarte okienka easter egga: Esc zamyka górne (jak krzyżyk), nic więcej.
  function goBack() {
    if (popupsRef.current?.pending()) {
      popupsRef.current.closeTop();
      return;
    }
    if (nestedActiveId) closeNested();
    else if (activeId) close();
  }

  // Wszystkie okienka easter egga zamknięte (D-100): przedmiot odwiedzony (serwer zapisze flagę wyróżnienia przy ukończeniu bloku) i
  // wyróżnienie w notatniku od razu. Bez dowodu, notatki i wpływu na licznik. W podglądzie ukończonego bloku - bez wyróżnienia.
  // Wyróżnienie już w notatniku (z /start albo znalezione wcześniej w tej sesji) - outro bez „Nowe”.
  function hasDistinction(hotspot: AnyHotspot): boolean {
    const badge = hotspot.media?.kind === 'popups' ? hotspot.media.badge : undefined;
    return !!badge && distinctions.some((d) => d.blockId === block.id && d.label === badge.label);
  }

  function foundEasterEgg(hotspot: AnyHotspot) {
    markVisited(hotspot.id);
    const badge = hotspot.media?.kind === 'popups' ? hotspot.media.badge : undefined;
    if (badge && !review && block.id) addDistinction({ blockId: block.id, label: badge.label });
  }

  // Drzwi (action:'next'): bez zoomu - gotowe (ready) kończą blok od razu, jak przycisk "Dalej" w pasku; wcześniej klik nic nie robi.
  function clickDoor() {
    if (!review && ready) onSubmit({ visited, noted });
  }

  function take(hotspot: AnyHotspot, from?: Element) {
    if (review || noted.includes(hotspot.id) || !block.id) return;
    if (!hotspot.evidence || !hotspot.note) {
      setShake((n) => n + 1);
      setToast(NOT_EVIDENCE_TOAST);
      later(TOAST_MS, () => setToast((t) => (t === NOT_EVIDENCE_TOAST ? null : t)));
      return;
    }
    setNoted((list) => [...list, hotspot.id]);
    addNote({ blockId: block.id, text: hotspot.note.text, kind: hotspot.note.kind });
    evidence.addPending(`${block.id}.${hotspot.id}`);
    // Ruch (D-090): nazwa przedmiotu leci od "Zabierz" do Notatnika (przed odłożeniem - przycisk jeszcze stoi na miejscu).
    flyEvidence(from, hotspot.label);
    hints.notify('evidence');
    goBack();
  }

  // Focus trap w nakładce (Tab / Shift+Tab krążą po jej przyciskach).
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !overlayRef.current) return;
    const focusables = [...overlayRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')].filter(
      (element) => !element.closest('[aria-hidden="true"]'),
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === overlayRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Klik w tło = Odłóż, ale tylko gdy bieżący poziom jest w pełni otwarty (drugi klik podwójnego kliknięcia w przedmiot trafia już w
  // nakładkę w fazie 'in' - nie może jej od razu zamknąć) i nie jako drugi klik serii.
  function onBackdrop(event: MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.detail > 1) return;
    // Okienka easter egga zamyka tylko krzyżyk (D-100).
    if (popupsRef.current?.pending()) return;
    const levelPhase = nestedActiveId ? nestedPhaseRef.current : phaseRef.current;
    if (levelPhase === 'open') goBack();
  }

  const overlayOpen = activeId !== null;
  // Czy pokazać grafikę zbliżenia: po dojechaniu kamery (open), dla sceny zagnieżdżonej - jej widok; dla przedmiotu wewnątrz - jego grafika.
  const showOuter = phase === 'open';
  const showInner = nestedPhase === 'open';

  return (
    // flex h-full flex-col (kod review PR #44): PlayerStage (contentLayout='scene') daje temu blokowi PEŁNĄ wysokość obszaru treści -
    // nagłówek shrink-0, kontener obrazu flex-1 min-h-0 (jawna wysokość dla formuły "contain" .scene-box).
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="shrink-0">
        {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
        <p className="mb-2 text-sm text-slate-600">Wybierz przedmioty na scenie, żeby się im przyjrzeć.</p>
        <ExploreFooter done={doneCount} total={required.length} noun="elementów" review={review} className="mb-2 text-xs text-slate-500" />
      </div>

      {imageUrl && !imageFailed && (
        // Widoczny obszar sceny: kontener zapytań ([container-type:size]) dla formuły "contain", `overflow-hidden` przycina scenę pod
        // kamerą, `isolate` zamyka z-indeksy hotspotów (1..29) i nakładki (30) w lokalnej warstwie (nie konkurują z paskami powłoki).
        // Nakładka zbliżenia leży TU (nie w pudełku obrazu) - na telefonie w pionie obraz jest szerszy od ekranu (panorama), a grafika i
        // przyciski muszą mieścić się w widocznej części.
        // data-zoom-open (globals.css, D-101): ramki punktów i podpowiedź panoramy pod zbliżeniem schowane (przebijałyby spod grafiki).
        <div
          ref={viewRef}
          data-zoom-open={overlayOpen ? '' : undefined}
          className="relative isolate flex min-h-0 flex-1 items-center justify-center overflow-hidden [container-type:size]"
        >
          <ScenePanContainer initialPanX={initialPanX}>
            <div
              ref={boxRef}
              className="scene-box relative isolate overflow-hidden rounded border border-slate-200"
              style={
                {
                  '--scene-ratio': String(aspectRatio),
                  height: 'auto',
                  aspectRatio: 'var(--scene-ratio)',
                  margin: 'auto',
                  ...(camera ?? {}),
                  transition: cameraTransition(reducedMotion, phase),
                } as CSSProperties
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt={block.imageAlt ?? ''}
                referrerPolicy="no-referrer"
                aria-hidden={overlayOpen ? true : undefined}
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
                  : `${hotspot.label}${noted.includes(hotspot.id) ? ' (w notatniku)' : seen ? ' (obejrzane)' : ''}`;
                return (
                  <button
                    key={hotspot.id}
                    type="button"
                    data-testid={`hotspot-overlay-${hotspot.id}`}
                    data-state={isDoor ? (ready ? 'ready' : 'blocked') : seen ? 'discovered' : interacted ? 'hidden' : 'hint'}
                    aria-label={label}
                    // Nieaktywne drzwi zostają SKUPIALNE (aria-disabled, nie disabled) - czytnik ma usłyszeć DLACZEGO. Pod otwartą
                    // nakładką przedmioty wychodzą z kolejności Tab i dostają aria-hidden.
                    aria-disabled={blocked}
                    aria-hidden={overlayOpen ? true : undefined}
                    title={blocked ? `Zbierz najpierw dowody: ${doneCount}/${required.length}` : undefined}
                    tabIndex={overlayOpen ? -1 : undefined}
                    onClick={(event) => (isDoor ? clickDoor() : open(hotspot, event.currentTarget))}
                    style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%`, zIndex: hotspotZIndex.get(hotspot.id) }}
                    // Ruch (D-090): wciśnięcie przedmiotu - scale .98 (100 ms), tylko bez reduced-motion i nie na zablokowanych drzwiach.
                    className={`scene-hotspot absolute min-h-[24px] min-w-[24px] rounded border-2 outline-none transition-[color,background-color,border-color,transform] duration-[100ms] ${blocked ? '' : 'motion-safe:active:scale-[.98]'} ${FOCUS_RING} ${
                      isDoor
                        ? ready
                          ? 'border-amber-500 bg-amber-400/20 hover:border-amber-600 hover:bg-amber-400/30'
                          : 'cursor-not-allowed border-slate-400/50 bg-slate-400/10'
                        : `hover:border-indigo-600 hover:bg-indigo-500/20 ${
                            seen ? 'border-green-600 bg-green-500/[0.07]' : interacted ? 'border-transparent' : 'border-indigo-400/70 bg-indigo-500/10 motion-safe:animate-pulse'
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
            </div>
          </ScenePanContainer>

          {overlayOpen && active && (
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label={current?.label ?? active.label}
              tabIndex={-1}
              data-testid="scene-zoom"
              data-phase={nestedActiveId ? `inner-${nestedPhase}` : phase}
              onKeyDown={trapFocus}
              onClick={onBackdrop}
              // Scena pod zbliżeniem przyciemniona (ink 35%) i rozmyta (3 px) - D-102, przywrócone po D-101; sama grafika zbliżenia ma
              // przezroczyste tło i cień po kształcie (.zoom-shadow). Przy oddalaniu (out) przyciemnienie znika razem z kamerą.
              className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 p-3 outline-none ${
                reducedMotion ? '' : 'transition-[background-color,backdrop-filter] duration-300'
              } ${phase === 'out' ? 'bg-transparent' : ZOOM_DIM}`}
            >
              {/* Stały region live (czytniki ogłaszają zmianę treści, nie region wstawiony razem z nią); widoczny tylko z tekstem. */}
              <p
                role="status"
                className={
                  toast ? 'absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-btn bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-card' : 'sr-only'
                }
              >
                {toast}
              </p>

              {nestedScene ? (
                <>
                  {/* Przy otwartym przedmiocie pulpitu "Wróć" znika - jedynym wyjściem jest wtedy Odłóż/Esc/tło (jeden poziom naraz). */}
                  {showOuter && !nestedActiveId && (
                    <button
                      type="button"
                      aria-label="Wróć"
                      data-autofocus
                      onClick={close}
                      className={`absolute left-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-ink/80 text-white shadow-card hover:bg-ink ${LIGHT_FOCUS}`}
                    >
                      <ArrowLeft aria-hidden="true" className="h-5 w-5" />
                    </button>
                  )}
                  <div
                    onClick={onBackdrop}
                    className={`flex h-[88%] w-[88%] min-h-0 items-center justify-center ${reducedMotion ? '' : 'transition-opacity duration-200'} ${showOuter ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <NestedSceneImage
                      contentBase={contentBase}
                      scene={nestedScene}
                      visited={visited}
                      noted={noted}
                      interacted={interacted}
                      // Przedmioty pulpitu nieaktywne, dopóki kamera nie dojedzie na monitor (niewidoczne nie mogą być klikalne).
                      overlayOpen={nestedActiveId !== null || !showOuter}
                      onBackdrop={onBackdrop}
                      onPick={openNested}
                    />
                  </div>
                  {activeInner && (
                    <div
                      onClick={onBackdrop}
                      // Okno na ekranie (D-104): nad pulpitem przyciemnienie jak przy zbliżeniu (ink 35% + blur 3 px), bez ruchu kamery;
                      // okienka easter egga pojawiają się na pulpicie BEZ przyciemnienia (jak wyskakujące okna na komputerze).
                      className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-3 ${activeInner.media?.kind === 'popups' ? '' : ZOOM_DIM}`}
                    >
                      {activeInner.media?.kind === 'popups' ? (
                        showInner && (
                          <PopupsEasterEgg
                            ref={popupsRef}
                            items={activeInner.media.items ?? []}
                            outro={activeInner.media.outro ?? ''}
                            badge={activeInner.media.badge}
                            reducedMotion={reducedMotion}
                            onFound={() => foundEasterEgg(activeInner)}
                            onDone={closeNested}
                            backLabel="Wróć do pulpitu"
                            alreadyFound={hasDistinction(activeInner)}
                          />
                        )
                      ) : (
                        <ZoomContent
                          hotspot={activeInner}
                          contentBase={contentBase}
                          onScreen
                          portrait={portraitStage}
                          visible={showInner}
                          reducedMotion={reducedMotion}
                          noted={noted.includes(activeInner.id)}
                          review={review}
                          shake={shake}
                          transcriptOpen={transcriptOpen}
                          onToggleTranscript={() => setTranscriptOpen((v) => !v)}
                          onTake={(from) => take(activeInner, from)}
                          onPutDown={closeNested}
                          onBackdrop={onBackdrop}
                        />
                      )}
                    </div>
                  )}
                </>
              ) : active.media?.kind === 'popups' ? (
                showOuter && (
                  <PopupsEasterEgg
                    ref={popupsRef}
                    items={active.media.items ?? []}
                    outro={active.media.outro ?? ''}
                    badge={active.media.badge}
                    reducedMotion={reducedMotion}
                    onFound={() => foundEasterEgg(active)}
                    onDone={close}
                    alreadyFound={hasDistinction(active)}
                  />
                )
              ) : (
                <ZoomContent
                  hotspot={active}
                  contentBase={contentBase}
                  portrait={portraitStage}
                  visible={showOuter}
                  reducedMotion={reducedMotion}
                  noted={noted.includes(active.id)}
                  review={review}
                  shake={shake}
                  transcriptOpen={transcriptOpen}
                  onToggleTranscript={() => setTranscriptOpen((v) => !v)}
                  onTake={(from) => take(active, from)}
                  onPutDown={close}
                  onBackdrop={onBackdrop}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Zawartość nakładki zbliżenia jednego przedmiotu: grafika (max 88% sceny, tylko cień) albo nagranie, pod nią Zabierz / Odłóż.
// Okno na ekranie (przedmiot pulpitu, D-104) - max 94% sceny; na telefonie w pionie grafika `imagePortrait`, jeśli treść ją ma.
function ZoomContent({
  hotspot,
  contentBase,
  visible,
  reducedMotion,
  noted,
  review,
  shake,
  transcriptOpen,
  onToggleTranscript,
  onTake,
  onPutDown,
  onBackdrop,
  onScreen = false,
  portrait = false,
}: {
  hotspot: AnyHotspot;
  contentBase: string;
  visible: boolean;
  reducedMotion: boolean;
  noted: boolean;
  review: boolean;
  shake: number;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  onTake: (from: HTMLElement) => void;
  onPutDown: () => void;
  onBackdrop: (event: MouseEvent<HTMLElement>) => void;
  onScreen?: boolean;
  portrait?: boolean;
}) {
  const fade = `${reducedMotion ? '' : 'transition-opacity duration-200'} ${visible ? 'opacity-100' : 'opacity-0'}`;
  // `key={shake}` montuje "Zabierz" od nowa, żeby powtórzyć animację potrząśnięcia - fokus (był na tym przycisku) wraca na nowy egzemplarz,
  // inaczej spadłby na <body>, poza nakładkę i focus trap.
  const takeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (shake > 0) takeRef.current?.focus();
  }, [shake]);
  return (
    <>
      <div
        data-testid="scene-zoom-graphic"
        onClick={onBackdrop}
        className={`flex ${onScreen ? 'max-h-[94%]' : 'max-h-[88%]'} min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 ${fade}`}
      >
        {visible && hotspot.media && (
          <ZoomGraphic media={hotspot.media} contentBase={contentBase} transcriptOpen={transcriptOpen} onToggleTranscript={onToggleTranscript} onScreen={onScreen} portrait={portrait} />
        )}
        {/* Przedmiot bez grafiki (treść sprzed D-086): opis zamiast pustego zbliżenia - ciemny panel z cieniem, bez białej karty. */}
        {visible && !hotspot.media && hotspot.content && (
          <p className="max-w-[88%] rounded-card bg-ink/90 p-4 text-base text-white shadow-card">{hotspot.content}</p>
        )}
      </div>
      {visible && (
        <div data-testid="scene-zoom-actions" className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          {noted ? (
            <p className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-success-soft px-4 text-sm font-bold text-success">
              {hotspot.note && <NoteKindIcon kind={hotspot.note.kind} />}W notatniku
            </p>
          ) : (
            !review && (
              <button
                key={shake}
                ref={takeRef}
                type="button"
                data-autofocus
                onClick={(event) => onTake(event.currentTarget)}
                className={`${shake > 0 ? 'scene-zoom-shake' : ''} min-h-[44px] rounded-btn bg-accent px-5 text-sm font-bold text-white hover:bg-accent-hover ${LIGHT_FOCUS}`}
              >
                Zabierz
              </button>
            )
          )}
          <button
            type="button"
            data-autofocus={noted || review ? true : undefined}
            onClick={onPutDown}
            // Ghost - jasny tekst i obrys na ciemnym (D-102); wypełnienie ink 50% zamiast white/10 - na scenie przyciemnionej tylko w 35%
            // biały tekst na jasnym fragmencie sceny miałby za mały kontrast.
            className={`min-h-[44px] rounded-btn border border-white/70 bg-ink/50 px-5 text-sm font-bold text-white hover:bg-ink/70 ${LIGHT_FOCUS}`}
          >
            Odłóż
          </button>
        </div>
      )}
    </>
  );
}

function ZoomGraphic({
  media,
  contentBase,
  transcriptOpen,
  onToggleTranscript,
  onScreen = false,
  portrait = false,
}: {
  media: HotspotMedia | InnerHotspotMedia;
  contentBase: string;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  onScreen?: boolean;
  portrait?: boolean;
}) {
  if (media.kind === 'image') {
    return <ZoomImage path={portrait && media.imagePortrait ? media.imagePortrait : media.src} alt={media.alt} contentBase={contentBase} wide={onScreen} />;
  }
  if (media.kind === 'audio') return <AudioZoom media={media} contentBase={contentBase} transcriptOpen={transcriptOpen} onToggleTranscript={onToggleTranscript} />;
  if (media.kind === 'document') {
    return (
      <div className="flex max-h-full w-[88%] min-h-0 flex-col rounded-card bg-ink/90 p-4 text-white shadow-card">
        {media.title && <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-white/70">{media.title}</h4>}
        <pre tabIndex={0} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed">
          {media.lines?.join('\n')}
        </pre>
      </div>
    );
  }
  return null;
}

function ZoomImage({ path, alt, contentBase, wide = false }: { path: string | undefined; alt: string | undefined; contentBase: string; wide?: boolean }) {
  const url = withStaticFragment(contentAssetUrl(contentBase, path, 'image'), usePrefersReducedMotion());
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL
    <img src={url} alt={alt ?? ''} referrerPolicy="no-referrer" className={`zoom-shadow min-h-0 max-h-full ${wide ? 'max-w-[94%]' : 'max-w-[88%]'} object-contain`} />
  );
}

// Nagranie (poczta głosowa): zbliżenie (media.image) z play/pauzą pod spodem; autoodtwarzanie przy otwarciu (klik = gest). Gotowy plik
// (audioUrl + transcript) ALBO nagranie z potoku TTS (narration, D-082). Transkrypcja - alternatywa tekstowa (WCAG 1.2.1) zamiast grafiki.
function AudioZoom({
  media,
  contentBase,
  transcriptOpen,
  onToggleTranscript,
}: {
  media: HotspotMedia | InnerHotspotMedia;
  contentBase: string;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
}) {
  const url = contentAssetUrl(contentBase, media.audioUrl ?? media.narration?.audioUrl, 'audio');
  const transcript = media.transcript ?? media.narration?.text;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => {});
    } else audio.pause();
  }

  return (
    <>
      {transcriptOpen && transcript ? (
        <div role="region" aria-label="Transkrypcja" tabIndex={0} className="min-h-0 max-h-full w-[88%] overflow-y-auto rounded-card bg-ink/80 p-4 text-sm text-white shadow-card">
          <p className="whitespace-pre-line">{transcript}</p>
        </div>
      ) : (
        media.image && <ZoomImage path={media.image} alt={media.alt} contentBase={contentBase} />
      )}
      <div className="flex shrink-0 items-center gap-3">
        {url && (
          <>
            <audio
              ref={audioRef}
              src={url}
              preload="metadata"
              hidden
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Wstrzymaj nagranie' : 'Odtwórz nagranie'}
              className={`flex h-11 w-11 items-center justify-center rounded-full bg-white text-accent-ink shadow-card hover:bg-accent-soft ${LIGHT_FOCUS}`}
            >
              {playing ? <Pause aria-hidden="true" className="h-5 w-5" /> : <Play aria-hidden="true" className="h-5 w-5 translate-x-0.5" />}
            </button>
          </>
        )}
        {transcript && (
          <button
            type="button"
            onClick={onToggleTranscript}
            aria-pressed={transcriptOpen}
            // Własne ciemne tło (D-101): biały tekst na scenie przyciemnionej tylko w 35% (D-102) miałby za mały kontrast na jasnych fragmentach.
            className={`min-h-[44px] rounded-btn bg-ink/80 px-3 text-sm font-semibold text-white underline shadow-card ${LIGHT_FOCUS}`}
          >
            Transkrypcja
          </button>
        )}
      </div>
    </>
  );
}

// Scena zagnieżdżona (monitor -> pulpit) w nakładce: obraz "contain" w ramce z jawnym rozmiarem (.hotspot-nested-scene-frame/-box,
// globals.css) z własnymi przedmiotami - ten sam wzorzec dostępności co scena główna; klik = okno nad pulpitem (bez kamery, D-104).
function NestedSceneImage({
  contentBase,
  scene,
  visited,
  noted,
  interacted,
  overlayOpen,
  onPick,
  onBackdrop,
}: {
  contentBase: string;
  scene: NestedScene;
  visited: string[];
  noted: string[];
  interacted: boolean;
  overlayOpen: boolean;
  onBackdrop: (event: MouseEvent<HTMLElement>) => void;
  onPick: (hotspot: InnerSceneHotspot, trigger: HTMLButtonElement) => void;
}) {
  const url = withStaticFragment(contentAssetUrl(contentBase, scene.image, 'image'), usePrefersReducedMotion());
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) setAspectRatio(img.naturalWidth / img.naturalHeight);
  }, [url]);
  if (!url) return null;
  const zIndex = hotspotStackZIndex(scene.hotspots);
  return (
    <div onClick={onBackdrop} className="hotspot-nested-scene-frame relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
      <div
        className="hotspot-nested-scene-box zoom-shadow relative isolate overflow-hidden"
        style={{ '--scene-ratio': String(aspectRatio), height: 'auto', aspectRatio: 'var(--scene-ratio)', margin: 'auto' } as CSSProperties}
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
              aria-label={`${hotspot.label}${noted.includes(hotspot.id) ? ' (w notatniku)' : seen ? ' (obejrzane)' : ''}`}
              aria-hidden={overlayOpen ? true : undefined}
              tabIndex={overlayOpen ? -1 : undefined}
              onClick={(event) => onPick(hotspot, event.currentTarget)}
              style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%`, zIndex: zIndex.get(hotspot.id) }}
              className={`scene-hotspot absolute min-h-[24px] min-w-[24px] rounded border-2 outline-none transition-[color,background-color,border-color,transform] duration-[100ms] motion-safe:active:scale-[.98] hover:border-indigo-600 hover:bg-indigo-500/20 ${FOCUS_RING} ${overlayOpen ? 'pointer-events-none' : ''} ${
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
