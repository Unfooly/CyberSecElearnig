// Tokeny ruchu (BRAND.md, „Ruch”; D-090) dla animacji z JS (Web Animations API). Te same wartości w tailwind.config.ts
// (duration-fast/base/slow, ease-out-soft/in-out-soft, animate-*) i globals.css (--motion-*).
export const MOTION = {
  fast: 120,
  base: 200,
  slow: 400,
  easeOutSoft: 'cubic-bezier(.2,.8,.2,1)',
  easeInOutSoft: 'cubic-bezier(.65,0,.35,1)',
} as const;

/** prefers-reduced-motion w chwili wywołania (dla animacji odpalanych z JS; komponenty z renderem - usePrefersReducedMotion). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Czy element umie animować (Web Animations API) - jsdom i stare przeglądarki nie: wtedy bez animacji, stan końcowy od razu. */
export function canAnimate(element: Element | null | undefined): boolean {
  return !!element && typeof (element as Element & { animate?: unknown }).animate === 'function';
}

const TARGET = '[data-evidence-target]';

/**
 * Dowód znaleziony: etykieta leci od klikniętego elementu do przycisku Notatnika (400 ms), potem ikona podskakuje 1 → 1.15 → 1 (250 ms).
 * Tylko transform/opacity na warstwie `position: fixed` (bez przesunięć układu); aria-hidden (komunikat dla czytnika daje licznik
 * dowodów). reduced-motion, brak celu albo brak Web Animations API - nic (dowód i tak jest w notatniku, licznik rośnie).
 */
export function flyEvidence(from: Element | null | undefined, label: string): void {
  if (typeof document === 'undefined' || !from || prefersReducedMotion()) return;
  const target = document.querySelector(TARGET);
  const start = from.getBoundingClientRect();
  if (!target || !canAnimate(target) || (start.width === 0 && start.height === 0)) return;
  const end = target.getBoundingClientRect();
  // Pełny ekran pokazuje wyłącznie poddrzewo elementu pełnoekranowego - etykieta musi być w nim, nie w body. Element pełnoekranowy
  // (ramka odtwarzacza) należy do Reacta: obcy węzeł dopisany na koniec nie przeszkadza w uzgadnianiu (React wstawia własne dzieci
  // po swoich referencjach), a etykieta i tak znika po 400 ms.
  const host = document.fullscreenElement ?? document.body;
  const chip = document.createElement('span');
  chip.setAttribute('aria-hidden', 'true');
  chip.dataset.testid = 'evidence-flight';
  // Po znakach (Array.from), nie jednostkach UTF-16 - bez rozcinania par surogatów.
  const chars = Array.from(label);
  chip.textContent = chars.length > 28 ? `${chars.slice(0, 27).join('')}…` : label;
  chip.className =
    'pointer-events-none fixed left-0 top-0 z-[100] max-w-[14rem] truncate rounded-btn bg-accent px-2 py-1 text-xs font-bold text-white shadow-card';
  host.appendChild(chip);
  if (!canAnimate(chip)) {
    chip.remove();
    return;
  }
  const chipBox = chip.getBoundingClientRect();
  const x0 = start.left + start.width / 2 - chipBox.width / 2;
  const y0 = start.top + start.height / 2 - chipBox.height / 2;
  const x1 = end.left + end.width / 2 - chipBox.width / 2;
  const y1 = end.top + end.height / 2 - chipBox.height / 2;
  const flight = chip.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) scale(.6)`, opacity: 1, offset: 0.85 },
      { transform: `translate(${x1}px, ${y1}px) scale(.4)`, opacity: 0 },
    ],
    { duration: MOTION.slow, easing: MOTION.easeOutSoft, fill: 'forwards' },
  );
  const finish = () => {
    chip.remove();
    target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 250, easing: MOTION.easeOutSoft });
  };
  flight.onfinish = finish;
  flight.oncancel = () => chip.remove();
}
