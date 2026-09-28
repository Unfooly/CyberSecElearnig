'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Scena pionowa, gdy kontener ma proporcje (szerokość / wysokość) poniżej tego progu - telefon w pionie (D-098). */
export const PORTRAIT_THRESHOLD = 0.8;

/**
 * Orientacja kontenera sceny (D-098): `null` - jeszcze nie zmierzono (przed pierwszym pomiarem w przeglądarce, także w HTML z serwera),
 * `true` - proporcje < PORTRAIT_THRESHOLD (telefon w pionie), `false` - poziomo. Wywołujący NIE renderuje grafiki, dopóki wartość jest
 * `null` - dzięki temu po SSR i przy każdym montowaniu kroku nie mignie (ani nie zacznie się pobierać) wariant poziomy, zanim pomiar
 * wybierze pionowy. Pomiar w useLayoutEffect (przed malowaniem) i ResizeObserverem przy każdej zmianie rozmiaru - obrót telefonu
 * przełącza wariant bez utraty stanu (stan żyje w komponencie wywołującym). Kontener bez wymiarów (np. jsdom) = poziomo.
 */
export function usePortraitContainer<T extends HTMLElement>(): [RefObject<T>, boolean | null] {
  const ref = useRef<T>(null);
  const [portrait, setPortrait] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setPortrait(width > 0 && height > 0 ? width / height < PORTRAIT_THRESHOLD : false);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, portrait];
}
