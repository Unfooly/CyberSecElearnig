'use client';

import type { TextLayerItem } from '@/lib/courses-types';
import { usePhoneLayout } from '@/lib/use-phone-layout';
import { FitText } from './BriefingScene';

// Warstwa tekstu na grafice (schemaVersion 6, D-114): tekst rysowany przez odtwarzacz w prostokątach (slotach) w % grafiki - jak sloty
// odprawy - zamiast wypalonego w SVG, więc grafika jest wspólna dla wszystkich języków. Leży NAD obrazem i POD przedmiotami sceny (bez
// zdarzeń wskaźnika - klik trafia w przedmiot). Tekst jest zwykłym tekstem strony (czytniki ekranu czytają go po opisie obrazu).
//
// Zasady (D-128, uwagi właściciela po przejściu modułu 2):
//  - rozmiar skaluje się z grafiką (FitText: największy, przy którym tekst mieści się w slocie), ale ma DOLNY LIMIT czytelności:
//    14 px na desktopie, 15 px na telefonie (D-103);
//  - tekst ZAWIJA SIĘ w szerokości slotu (każdy styl; `\n` z treści to jawny podział wiersza) między słowami - rozmiar maleje do
//    limitu, żeby słowa zostały w całości, a słowo szersze niż slot nawet przy limicie jest łamane w środku (FitText `wholeWords`);
//    gdy przy dolnym limicie tekst nie mieści się w wysokości slotu, wychodzi poza niego w pionie (wyśrodkowany) - nigdy nie jest
//    ucinany ani zmniejszany poniżej limitu;
//  - font dziedziczony z odtwarzacza (Plus Jakarta Sans) - także „ekran urządzenia”, bez kroju o stałej szerokości; wyjątek: pismo
//    odręczne;
//  - kolor z treści (`tone`): ciemny tekst na jasnym tle slotu (domyślnie) albo jasny na ciemnym - odtwarzacz nie zna koloru grafiki.

export const TEXT_LAYER_MIN_PX = { desktop: 14, phone: 15 } as const;

// Górny rozmiar czcionki jako ułamek wysokości slotu: jednowierszowe etykiety i szyldy wypełniają slot, ekran i pismo mają zwykle 2+ wiersze.
const STYLE: Record<NonNullable<TextLayerItem['style']>, { className: string; maxRatio: number }> = {
  label: { className: 'font-semibold', maxRatio: 0.8 },
  sign: { className: 'font-bold uppercase tracking-wide', maxRatio: 0.8 },
  screen: { className: 'font-medium', maxRatio: 0.45 },
  handwritten: { className: 'italic [font-family:"Segoe_Print","Bradley_Hand","Comic_Sans_MS",cursive]', maxRatio: 0.45 },
};

// Kontrast z białym/ciemnym tłem slotu >= 7:1 (slate-900 na białym ~17:1, biały na tle ciemniejszym niż #595959).
const TONE: Record<NonNullable<TextLayerItem['tone']>, Record<NonNullable<TextLayerItem['style']>, string>> = {
  dark: { label: 'text-slate-900', sign: 'text-slate-900', screen: 'text-slate-900', handwritten: 'text-indigo-900' },
  light: { label: 'text-white', sign: 'text-white', screen: 'text-white', handwritten: 'text-white' },
};

export default function TextLayer({ items, portrait = false, ariaHidden = false }: { items?: TextLayerItem[]; portrait?: boolean; ariaHidden?: boolean }) {
  const phone = usePhoneLayout();
  if (!items || items.length === 0) return null;
  const minPx = phone ? TEXT_LAYER_MIN_PX.phone : TEXT_LAYER_MIN_PX.desktop;
  return (
    <div data-testid="text-layer" aria-hidden={ariaHidden ? true : undefined} className="pointer-events-none absolute inset-0">
      {items.map((item) => {
        const rect = portrait && item.portrait ? item.portrait : item;
        const kind = item.style ?? 'label';
        // Nieznana wartość (nowsza treść, starszy klient) = domyślny ciemny tekst, nie błąd renderu.
        const tone = item.tone === 'light' ? 'light' : 'dark';
        return (
          <div
            key={item.id}
            data-testid={`text-layer-${item.id}`}
            data-tone={tone}
            className="absolute flex items-center justify-center text-center"
            style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
          >
            <FitText
              maxRatio={STYLE[kind].maxRatio}
              fitKey={`${item.id}:${item.text}:${portrait ? 'p' : 'l'}:${minPx}`}
              minPx={minPx}
              wholeWords
              className={`flex h-full w-full items-center justify-center whitespace-pre-line leading-tight ${STYLE[kind].className} ${TONE[tone][kind]}`}
            >
              {item.text}
            </FitText>
          </div>
        );
      })}
    </div>
  );
}
