'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ContentBlock, SceneExploration, SceneHotspot } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { flyEvidence } from '@/lib/motion';
import { useNotes } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteHint } from '../player/hints';
import ExploreFooter from './ExploreFooter';

export type FlipCardsProps = {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { visited: string[]; noted: string[] }) => void;
  onReady: (submit: (() => void) | null) => void;
  review?: boolean;
  initial?: SceneExploration;
  onExplore?: (state: SceneExploration) => void;
};

/** Stan z serwera (D-128) ograniczony do kart TEJ wersji bloku; zabrany = obejrzana karta-dowód z notatką (jak SceneHotspotsBlock i API). */
function restored(hotspots: readonly SceneHotspot[], initial: SceneExploration | undefined) {
  const known = new Set(hotspots.map((h) => h.id));
  const visited = [...new Set(initial?.visited ?? [])].filter((id) => known.has(id));
  const evidenceIds = new Set(hotspots.filter((h) => h.evidence && h.note).map((h) => h.id));
  const noted = [...new Set(initial?.noted ?? [])].filter((id) => visited.includes(id) && evidenceIds.has(id));
  return { visited, noted };
}

/**
 * Karty obracane (SCENE_HOTSPOTS `presentation: 'flipCards'`, D-209 - jak na nagraniu „Ryzyko dla organizacji”): duże karty na cały
 * obszar bloku - przód to ilustracja (`cardImage`), podpis (`label`) stale pod kartą; klik obraca kartę o 180° (oś pionowa) i pokazuje
 * tekst (`content`) na odwrocie, drugi klik obraca z powrotem. Pierwsze obrócenie = przedmiot obejrzany, a karta-dowód trafia do notatnika
 * (jak otwarcie zbliżenia w scenie, D-187). Stan bloku (`visited`/`noted`), wymagalność, „Dalej” w pasku i stan częściowy - jak w scenie.
 * Układ: szeroki obszar (komputer, telefon poziomo) - karty w jednym rzędzie; wąski - siatka 2 × 2 (`.flip-cards`, globals.css).
 * reduced-motion: bez animacji obrotu (zamiana stron od razu). A11y: karta to przycisk z `aria-pressed`, odwrocie opisuje go po obróceniu.
 */
export default function FlipCardsBlock({ block, contentBase, onSubmit, onReady, review = false, initial, onExplore }: FlipCardsProps) {
  const hotspots = block.hotspots ?? [];
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const [{ visited, noted }, setState] = useState(() => restored(hotspots, initial));
  // Karty obejrzane wcześniej (powrót do modułu) leżą odwrócone - gracz widzi, co już przeczytał.
  const [flipped, setFlipped] = useState<string[]>(() => (review ? [] : restored(hotspots, initial).visited));
  // Karty, których ilustracja się nie wczytała (B-187) - przód z podpisem.
  const [failedImages, setFailedImages] = useState<string[]>([]);
  // Blokada synchroniczna przed podwójnym zebraniem dowodu (podwójny klik w tej samej klatce; API odrzuca duplikat).
  const takenRef = useRef<Set<string>>(new Set());

  const required = requiredItemIds(hotspots, block.requiredHotspots);
  const doneCount = required.filter((id) => visited.includes(id)).length;
  const ready = doneCount >= required.length;
  useCompleteHint(block.reactions?.complete, ready, review);

  useEffect(() => {
    if (review) return;
    onReady(ready ? () => onSubmit({ visited, noted }) : null);
    // onReady/onSubmit celowo poza deps - remount przez `key` na zmianę bloku (jak SceneHotspotsBlock).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visited, noted, review, ready]);

  const lastExplored = useRef(JSON.stringify({ visited, noted }));
  useEffect(() => {
    const state = JSON.stringify({ visited, noted });
    if (review || state === lastExplored.current) return;
    lastExplored.current = state;
    onExplore?.({ visited, noted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visited, noted, review]);

  function toggle(hotspot: SceneHotspot, card: HTMLElement) {
    setFlipped((list) => (list.includes(hotspot.id) ? list.filter((id) => id !== hotspot.id) : [...list, hotspot.id]));
    if (review || visited.includes(hotspot.id)) return;
    const take = !!hotspot.evidence && !!hotspot.note && !!block.id && !takenRef.current.has(hotspot.id);
    setState((s) => ({
      visited: s.visited.includes(hotspot.id) ? s.visited : [...s.visited, hotspot.id],
      noted: take && !s.noted.includes(hotspot.id) ? [...s.noted, hotspot.id] : s.noted,
    }));
    if (take && hotspot.note && block.id) {
      takenRef.current.add(hotspot.id);
      addNote({ blockId: block.id, text: hotspot.note.text, kind: hotspot.note.kind });
      evidence.addPending(`${block.id}.${hotspot.id}`);
      // Bez dymka „Mamy dowód!” (hints.notify): w scenie zwija go otwarte zbliżenie, tu nakładki nie ma i dymek (overlay układu 'scene')
      // leżałby na kartach przez 8 s, przejmując kliknięcia (code review D-209). Dowód widać po locie do notatnika.
      flyEvidence(card, hotspot.label);
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="flip-cards-block">
      <div className="shrink-0">
        {block.prompt && <p className="mb-3 text-lg text-slate-900">{block.prompt}</p>}
        {/* Niski ekran (telefon poziomo): instrukcję mówi już dymek podpowiedzi (`tip`), a miejsce idzie na tekst odwrocia (≥ 16 px). */}
        <p className="mb-2 text-sm text-slate-600 [@media(max-height:500px)]:hidden">Kliknij kartę, żeby ją odwrócić.</p>
        <ExploreFooter done={doneCount} total={required.length} noun="kart" verb="Odwrócono" review={review} className="mb-2 text-xs text-slate-500" />
      </div>
      <div className="flip-cards min-h-0 flex-1" style={{ '--n': hotspots.length } as CSSProperties}>
        <ul className="flip-cards-grid">
          {hotspots.map((hotspot) => {
            const isFlipped = flipped.includes(hotspot.id);
            const seen = visited.includes(hotspot.id);
            const src = hotspot.cardImage ? contentAssetUrl(contentBase, hotspot.cardImage, 'image') : null;
            const backId = `flip-back-${block.id ?? 'blok'}-${hotspot.id}`;
            return (
              <li key={hotspot.id} className="flip-cards-cell" data-testid="flip-card" data-flipped={isFlipped ? 'true' : 'false'}>
                <button
                  type="button"
                  className="flip-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-700"
                  aria-pressed={isFlipped}
                  aria-label={seen && !review ? `${hotspot.label} (obejrzane)` : hotspot.label}
                  aria-describedby={isFlipped ? backId : undefined}
                  onClick={(event) => toggle(hotspot, event.currentTarget)}
                >
                  <span className="flip-card-inner">
                    <span className="flip-card-face flip-card-front" aria-hidden={isFlipped}>
                      {src && !failedImages.includes(hotspot.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- zasób z CONTENT_BASE_URL (CSP img-src), bez optymalizatora Next
                        <img
                          src={src}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                          data-testid="flip-card-image"
                          onError={() => setFailedImages((list) => (list.includes(hotspot.id) ? list : [...list, hotspot.id]))}
                        />
                      ) : (
                        // Brak ilustracji (zła ścieżka, błąd wczytania, B-187): przód z podpisem zamiast pustego ciemnego pola.
                        <span className="flex h-full w-full items-center justify-center p-4 text-center text-lg font-semibold text-white" data-testid="flip-card-fallback">
                          {hotspot.label}
                        </span>
                      )}
                      <span className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-indigo-700 shadow">
                        <RotateCcw className="h-5 w-5" aria-hidden="true" />
                      </span>
                    </span>
                    <span className="flip-card-face flip-card-back" aria-hidden={!isFlipped}>
                      <span id={backId} className="flip-card-text" data-testid="flip-card-back">
                        {hotspot.content}
                      </span>
                    </span>
                  </span>
                </button>
                {/* Podpis i ✓ tylko dla oka: nazwę i stan („obejrzane”) czytnik dostaje z przycisku (bez dublowania). */}
                <span className="flip-card-label" aria-hidden="true">
                  {seen && !review && <Check className="mr-1 inline h-4 w-4 text-emerald-600" />}
                  {hotspot.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
