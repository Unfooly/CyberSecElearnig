'use client';

import type { TextLayerItem } from '@/lib/courses-types';
import { FitText } from './BriefingScene';

// Warstwa tekstu na grafice (schemaVersion 6, D-114): tekst rysowany przez odtwarzacz w prostokątach w % grafiki (jak sloty odprawy),
// zamiast wypalonego w SVG - grafika jest wspólna dla wszystkich języków. Leży NAD obrazem i POD przedmiotami sceny (bez zdarzeń
// wskaźnika - klik trafia w przedmiot). Rozmiar czcionki dopasowuje FitText do prostokąta; jednolinijkowe style mają minimum 15 px (D-103).
// Tekst jest zwykłym tekstem strony (czytniki ekranu czytają go po opisie obrazu).

const STYLE: Record<NonNullable<TextLayerItem['style']>, { className: string; wrap: boolean }> = {
  label: { className: 'font-semibold text-slate-900', wrap: false },
  sign: { className: 'font-bold uppercase tracking-wide text-slate-900', wrap: false },
  screen: { className: 'font-mono text-slate-800', wrap: true },
  handwritten: { className: 'italic text-indigo-900 [font-family:"Segoe_Print","Bradley_Hand","Comic_Sans_MS",cursive]', wrap: true },
};

export default function TextLayer({ items, portrait = false, ariaHidden = false }: { items?: TextLayerItem[]; portrait?: boolean; ariaHidden?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div data-testid="text-layer" aria-hidden={ariaHidden ? true : undefined} className="pointer-events-none absolute inset-0">
      {items.map((item) => {
        const rect = portrait && item.portrait ? item.portrait : item;
        const style = STYLE[item.style ?? 'label'];
        return (
          <div
            key={item.id}
            data-testid={`text-layer-${item.id}`}
            className="absolute flex items-center justify-center text-center"
            style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
          >
            <FitText
              maxRatio={style.wrap ? 0.45 : 0.8}
              fitKey={`${item.id}:${item.text}:${portrait ? 'p' : 'l'}`}
              minPx={style.wrap ? undefined : 15}
              className={`flex h-full w-full items-center justify-center leading-tight ${style.wrap ? 'whitespace-pre-line break-words' : 'whitespace-nowrap'} ${style.className}`}
            >
              {item.text}
            </FitText>
          </div>
        );
      })}
    </div>
  );
}
