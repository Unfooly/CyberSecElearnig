'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/lib/courses-types';
import { contentAssetUrl } from '@/lib/content-assets';
import ExploreFooter, { requiredIds } from './ExploreFooter';

// Scena z punktami: ilustracja (tylko <img>, nigdy inline SVG - D-051) z klikalnymi prostokątami w % obrazu. Te same punkty są też listą
// przycisków pod obrazem: to główna ścieżka dla klawiatury, czytników ekranu i dotyku (małe prostokąty na 390 px trudno trafić).
// Odpowiedź dla serwera: { visited: [id...] }.
export default function SceneHotspotsBlock({
  block,
  contentBase,
  onSubmit,
  disabled,
  review = false,
}: {
  block: ContentBlock;
  contentBase: string;
  onSubmit: (answer: { visited: string[] }) => void;
  disabled: boolean;
  review?: boolean;
}) {
  const hotspots = block.hotspots ?? [];
  const [visited, setVisited] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = contentAssetUrl(contentBase, block.image, 'image');
  const active = hotspots.find((hotspot) => hotspot.id === activeId) ?? null;

  const required = requiredIds(
    hotspots.map((hotspot) => hotspot.id),
    block.requiredHotspots,
  );
  const doneCount = required.filter((id) => visited.includes(id)).length;

  function open(id: string) {
    setActiveId(id);
    setVisited((current) => (current.includes(id) ? current : [...current, id]));
  }

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
          {hotspots.map((hotspot) => (
            <button
              key={hotspot.id}
              type="button"
              // Nakładka tylko dla myszy i dotyku; klawiatura i czytniki używają listy poniżej (jeden cel na punkt).
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => open(hotspot.id)}
              style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
              className={`absolute min-h-[24px] min-w-[24px] rounded border-2 ${
                visited.includes(hotspot.id) ? 'border-green-600 bg-green-500/20' : 'border-indigo-600 bg-indigo-500/20'
              } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
            />
          ))}
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
          <div className="rounded bg-slate-50 p-3">
            <p className="mb-1 text-sm font-semibold text-slate-900">{active.label}</p>
            <p className="whitespace-pre-line text-slate-800">{active.content}</p>
          </div>
        )}
      </div>

      <ExploreFooter
        done={doneCount}
        total={required.length}
        noun="elementów"
        onSubmit={() => onSubmit({ visited })}
        disabled={disabled}
        review={review}
      />
    </div>
  );
}
