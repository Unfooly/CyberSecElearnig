import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MOTION, flyEvidence } from './motion';
import { usePresence } from './use-presence';

// Ruch (D-090): lot dowodu do Notatnika i animacja wyjścia nakładek - reduced-motion zawsze bez ruchu.

type FakeAnimation = { onfinish: (() => void) | null; oncancel: (() => void) | null };

function setReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({ ...original(query), matches: reduce && query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe('flyEvidence', () => {
  let calls: { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: FakeAnimation }[];
  let target: HTMLButtonElement;
  let from: HTMLButtonElement;
  let restoreMedia: () => void = () => {};

  beforeEach(() => {
    calls = [];
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation: FakeAnimation = { onfinish: null, oncancel: null };
      calls.push({ element: this, keyframes, options, animation });
      return animation;
    };
    target = document.createElement('button');
    target.setAttribute('data-evidence-target', '');
    from = document.createElement('button');
    document.body.append(target, from);
    vi.spyOn(from, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 300, width: 80, height: 40 } as DOMRect);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 900, top: 10, width: 40, height: 40 } as DOMRect);
  });
  afterEach(() => {
    restoreMedia();
    restoreMedia = () => {};
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('etykieta leci 400 ms (ease-out-soft) od klikniętego elementu do Notatnika, potem znika, a ikona podskakuje 1 -> 1.15 -> 1 (250 ms)', () => {
    flyEvidence(from, 'Karteczka przy monitorze');
    const chip = document.querySelector('[data-testid="evidence-flight"]');
    expect(chip).toHaveTextContent('Karteczka przy monitorze');
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    expect(calls).toHaveLength(1);
    expect(calls[0].element).toBe(chip);
    expect(calls[0].options).toMatchObject({ duration: MOTION.slow, easing: MOTION.easeOutSoft });
    // Tylko transform/opacity (bez przesunięć układu).
    for (const frame of calls[0].keyframes) expect(Object.keys(frame).filter((key) => key !== 'offset').sort()).toEqual(['opacity', 'transform']);

    calls[0].animation.onfinish?.();
    expect(document.querySelector('[data-testid="evidence-flight"]')).toBeNull();
    expect(calls[1].element).toBe(target);
    expect(calls[1].options).toMatchObject({ duration: 250 });
    expect(calls[1].keyframes.map((frame) => frame.transform)).toEqual(['scale(1)', 'scale(1.15)', 'scale(1)']);
  });

  it('w trybie pełnoekranowym etykieta trafia do elementu pełnoekranowego (poza nim nie byłoby jej widać)', () => {
    const frame = document.createElement('main');
    document.body.append(frame);
    Object.defineProperty(document, 'fullscreenElement', { value: frame, configurable: true });
    try {
      flyEvidence(from, 'Karteczka');
      expect(document.querySelector('[data-testid="evidence-flight"]')?.parentElement).toBe(frame);
    } finally {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    }
  });

  it('długa etykieta (treść notatki z teczki) jest skracana', () => {
    flyEvidence(from, 'Mail z 8:47 wysłano z sieci w Bukareszcie — tej samej, z której zalogowano się do banku.');
    expect(document.querySelector('[data-testid="evidence-flight"]')?.textContent).toMatch(/^.{27}…$/);
  });

  it('prefers-reduced-motion: bez lotu i bez podskoku', () => {
    restoreMedia = setReducedMotion(true);
    flyEvidence(from, 'Karteczka');
    expect(document.querySelector('[data-testid="evidence-flight"]')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('bez celu (moduł bez Notatnika), bez elementu źródłowego albo bez Web Animations API: nic', () => {
    flyEvidence(undefined, 'Karteczka');
    target.remove();
    flyEvidence(from, 'Karteczka');
    document.body.append(target);
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    flyEvidence(from, 'Karteczka');
    expect(document.querySelector('[data-testid="evidence-flight"]')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('usePresence', () => {
  let restoreMedia: () => void = () => {};
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    restoreMedia();
    restoreMedia = () => {};
  });

  it('po zamknięciu nakładka zostaje 140 ms w stanie "closing", potem znika; ponowne otwarcie przerywa wyjście', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 140), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, closing: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => {
      vi.advanceTimersByTime(139);
    });
    expect(result.current.mounted).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ mounted: false, closing: false });

    rerender({ open: true });
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  it('prefers-reduced-motion: znika od razu', () => {
    restoreMedia = setReducedMotion(true);
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 140), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, closing: false });
  });
});
