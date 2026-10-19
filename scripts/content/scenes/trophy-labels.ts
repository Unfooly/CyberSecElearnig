/**
 * Napisy trofeów osiągnięć (`trophyBadge`, `trophyHelpdesk`) w scenie ze `strings` (wersje językowe jak D-135): wstęga z nazwą,
 * pigułka rangi i krótkie etykiety idą przez `fitText` w jednej linii, od max(rozmiar, minimum) w dół do minimum. Wstęga i pigułka
 * rosną do szerokości tekstu (do `maxW`), zanim tekst zacznie się zmniejszać - dłuższy napis innego języka nie wychodzi poza kształt.
 * Sceny bez `strings` rysują dotychczasowe `<text>` w samych klockach (ta sama grafika bajt w bajt).
 */
import { P } from './palette.js';
import { fitText, measureText } from './text.js';
import type { PropContext } from './types.js';

/** Klocek w trybie dopasowania (kompozytor podaje dodatnie `minFontSize` tylko w scenie ze `strings`). */
export const trophyFitMode = (context?: PropContext): context is PropContext => (context?.minFontSize ?? 0) > 0;

const line = (context: PropContext, slot: string, label: string, size: number, spacing: number, box: { x: number; y: number; w: number; h: number }, fill: string) =>
  fitText(label, {
    slot, ...box, size: Math.max(size, context.minFontSize), minSize: context.minFontSize, maxLines: 1, align: 'middle', valign: 'middle',
    bold: true, family: 'sans', spacing, fill, where: context.where,
  });

/** Szerokość kształtu: bazowa albo większa, gdy tekst w rozmiarze startowym potrzebuje więcej miejsca (z marginesem `pad`), najwyżej `maxW`. */
const grow = (context: PropContext, label: string, size: number, spacing: number, w: number, maxW: number, pad: number) =>
  Math.min(maxW, Math.max(w, Math.ceil(measureText(label, { size: Math.max(size, context.minFontSize), bold: true, spacing }) + 2 * pad)));

/** Wstęga u dołu trofeum (kształt jak `banner` klocków) z napisem dopasowanym. */
export function fitBanner(context: PropContext, slot: string, cx: number, y: number, w: number, maxW: number, label: string, fill: string, dark: string, size: number): string {
  const pad = 22;
  const bw = grow(context, label, size, 2, w, maxW, pad);
  return (
    `<path d="M${cx - bw / 2 - 34} ${y + 8} h34 v44 h-34 l14 -22 z" fill="${dark}"/><path d="M${cx + bw / 2 + 34} ${y + 8} h-34 v44 h34 l-14 -22 z" fill="${dark}"/>` +
    `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="52" rx="6" fill="${fill}"/>` +
    `<path d="M${cx - bw / 2} ${y + 52} l20 12 v-12 z M${cx + bw / 2} ${y + 52} l-20 12 v-12 z" fill="${P.ink}" opacity="0.45"/>` +
    line(context, slot, label, size, 2, { x: cx - bw / 2 + pad, y: y + 4, w: bw - 2 * pad, h: 44 }, P.white)
  );
}

/** Pigułka rangi nad trofeum (wysokość 36) z napisem dopasowanym. */
export function fitPill(context: PropContext, slot: string, cx: number, y: number, w: number, maxW: number, label: string, fill: string, size = 18): string {
  const pad = 16;
  const pw = grow(context, label, size, 3, w, maxW, pad);
  return `<rect x="${cx - pw / 2}" y="${y}" width="${pw}" height="36" rx="18" fill="${fill}"/>` + line(context, slot, label, size, 3, { x: cx - pw / 2 + pad, y: y + 2, w: pw - 2 * pad, h: 32 }, P.white);
}

/** Krótki napis wyśrodkowany w stałym pudełku (bez zmiany kształtu pod nim). */
export function fitCentered(context: PropContext, slot: string, label: string, size: number, spacing: number, box: { x: number; y: number; w: number; h: number }, fill: string): string {
  return line(context, slot, label, size, spacing, box, fill);
}
