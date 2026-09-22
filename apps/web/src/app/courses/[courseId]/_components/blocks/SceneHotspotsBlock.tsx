'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import { requiredItemIds } from '@/lib/required-items';
import { useNotes, NoteKindIcon } from '../player/notes';
import { useEvidence } from '../player/evidence';
import { useCompleteReaction, useMascotReaction } from '../player/mascot-reaction';
import ExploreFooter from './ExploreFooter';

// Scena z punktami: ilustracja (tylko <img>, nigdy inline SVG - D-051) z klikalnymi prostokątami w % obrazu. Punkty na obrazie są
// niewidoczne do najechania (lekki puls podpowiada je do pierwszego kliknięcia); te same punkty są listą przycisków pod obrazem: to główna
// ścieżka dla klawiatury, czytników ekranu i dotyku (małe prostokąty na 390 px trudno trafić), więc nakładki są aria-hidden i poza kolejnością
// Tab. Kliknięty punkt otwiera kartę; punkt-dowód ma "Dodaj do notatnika". Ukończenie po wymaganych punktach (reszta to "smaczki").
// Odpowiedź dla serwera: { visited: [id...], noted: [id...] }.
export default function SceneHotspotsBlock({
  block,
  contentBase,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { visited: string[]; noted: string[] }) => void;
  disabled: boolean;
  review?: boolean;
}) {
  const hotspots = block.hotspots ?? [];
  const { addNote } = useNotes();
  const evidence = useEvidence();
  const mascot = useMascotReaction();
  const [visited, setVisited] = useState<string[]>([]);
  const [noted, setNoted] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = contentAssetUrl(contentBase, block.image, 'image');
  const active = hotspots.find((hotspot) => hotspot.id === activeId) ?? null;

  const required = requiredItemIds(hotspots, block.requiredHotspots);
  const doneCount = required.filter((id) => visited.includes(id)).length;
  useCompleteReaction(block.reactions?.complete, doneCount >= required.length, review);

  function open(id: string) {
    setInteracted(true);
    setActiveId(id);
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
  }

  function addToNotepad(id: string) {
    const hotspot = hotspots.find((candidate) => candidate.id === id);
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
            return (
              <button
                key={hotspot.id}
                type="button"
                data-testid={`hotspot-overlay-${hotspot.id}`}
                data-state={seen ? 'discovered' : interacted ? 'hidden' : 'hint'}
                // Nakładka tylko dla myszy i dotyku; klawiatura i czytniki używają listy poniżej (jeden cel na punkt).
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => open(hotspot.id)}
                style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
                className={`absolute min-h-[24px] min-w-[24px] rounded border-2 transition-colors hover:border-indigo-600 hover:bg-indigo-500/20 ${
                  seen
                    ? 'border-green-600 bg-green-500/20'
                    : interacted
                      ? 'border-transparent'
                      : 'border-indigo-400/70 bg-indigo-500/10 motion-safe:animate-pulse'
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
      )}

      <ul aria-label="Elementy sceny" className="flex flex-wrap gap-2">
        {hotspots.map((hotspot) => (
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
        ))}
      </ul>

      <div aria-live="polite" className="mt-4 min-h-[3rem]">
        {active && (
          <article data-testid="hotspot-card" aria-label={active.label} className="rounded bg-slate-50 p-3 ring-1 ring-slate-200">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">{active.label}</h3>
            <p className="whitespace-pre-line text-slate-800">{active.content}</p>
            {active.evidence && active.note && !review && (
              <div className="mt-3">
                {isNoted(active.id) ? (
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-green-700">
                    <NoteKindIcon kind={active.note.kind} />
                    Dodano do notatnika
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => addToNotepad(active.id)}
                    className="min-h-[44px] rounded border border-indigo-600 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100"
                  >
                    Dodaj do notatnika
                  </button>
                )}
              </div>
            )}
          </article>
        )}
      </div>

      <ExploreFooter
        done={doneCount}
        total={required.length}
        noun="elementów"
        onSubmit={() => onSubmit({ visited, noted })}
        disabled={disabled}
        review={review}
      />
    </div>
  );
}
