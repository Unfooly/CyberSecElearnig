import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FitText } from './BriefingScene';

// FitText (odprawa, D-081/D-103). jsdom nie liczy układu - wymiary podstawiamy: pudełko ma stałe clientWidth/clientHeight, a treść
// (jedna linijka) ma szerokość ~0,6 x rozmiar czcionki x liczba znaków i wysokość = rozmiar czcionki, jak w przeglądarce.
let box = { width: 100, height: 10 };
const CHARS = 8;

function fontOf(element: HTMLElement): number {
  return parseFloat(element.style.fontSize || '16');
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => box.width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => box.height);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.max(box.width, fontOf(this) * 0.6 * CHARS);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.max(box.height, fontOf(this));
  });
});
afterEach(() => vi.restoreAllMocks());

const fitted = () => screen.getByTestId('fit');

describe('FitText', () => {
  it('bez minPx: największy rozmiar mieszczący się w pudełku (tu - wysokość 10 px), bez odkrywania overflow', () => {
    box = { width: 200, height: 10 };
    render(
      <FitText testId="fit" fitKey="a" maxRatio={1}>
        Detektyw
      </FitText>,
    );
    expect(fontOf(fitted())).toBeLessThanOrEqual(10.01);
    expect(fontOf(fitted())).toBeGreaterThan(9.5);
    expect(fitted().style.overflow).toBe('');
  });

  it('minPx: slot niższy niż minimum, szerokość się mieści - czcionka = minPx i overflow widoczny (tekst nieucięty)', () => {
    box = { width: 200, height: 10 };
    render(
      <FitText testId="fit" fitKey="a" maxRatio={1} minPx={15}>
        Detektyw
      </FitText>,
    );
    expect(fontOf(fitted())).toBeGreaterThanOrEqual(14.99);
    expect(fitted().style.overflow).toBe('visible');
  });

  it('minPx: szerokość się nie mieści przy minimum - czcionka poniżej minPx (bardzo długie imię dalej się zmniejsza)', () => {
    box = { width: 50, height: 10 };
    render(
      <FitText testId="fit" fitKey="a" maxRatio={1} minPx={15}>
        Detektyw
      </FitText>,
    );
    // 0,6 x 8 znaków x rozmiar <= 50 -> rozmiar <= ~10,4.
    expect(fontOf(fitted())).toBeLessThan(15);
    expect(fontOf(fitted()) * 0.6 * CHARS).toBeLessThanOrEqual(51);
  });

  it('bez minPx treść niemieszcząca się nawet przy minimum 6 px zostaje przycięta (overflow nie odkryty - D1 z code review)', () => {
    box = { width: 200, height: 4 };
    render(
      <FitText testId="fit" fitKey="a" maxRatio={1}>
        Detektyw
      </FitText>,
    );
    expect(fontOf(fitted())).toBe(6);
    expect(fitted().style.overflow).toBe('');
  });

  describe('wholeWords (warstwa tekstu, D-128): słowo = jedna linijka o szerokości 0,6 x rozmiar x liczba znaków', () => {
    it('słowo mieści się dopiero przy mniejszej czcionce (powyżej minimum): rozmiar maleje, słowo zostaje w całości', () => {
      box = { width: 100, height: 40 };
      render(
        <FitText testId="fit" fitKey="a" maxRatio={1} minPx={14} wholeWords>
          Detektyw
        </FitText>,
      );
      // 0,6 x 8 x rozmiar <= 100 (+1 px tolerancji) -> ~21 px (wysokość pozwalałaby na 40 px).
      expect(fontOf(fitted()) * 0.6 * CHARS).toBeLessThanOrEqual(101);
      expect(fontOf(fitted())).toBeGreaterThan(19.5);
      expect(fitted().style.overflowWrap).toBe('normal');
    });

    it('słowo szersze niż slot nawet przy minimum: czcionka = minPx (nigdy mniej) i dopiero wtedy łamanie w środku słowa', () => {
      box = { width: 50, height: 40 };
      render(
        <FitText testId="fit" fitKey="a" maxRatio={1} minPx={14} wholeWords>
          Detektyw
        </FitText>,
      );
      expect(fontOf(fitted())).toBe(14);
      expect(fitted().style.overflowWrap).toBe('anywhere');
    });
  });

  it('ponowne dopasowanie (zmiana fitKey) czyści overflow z poprzedniego', () => {
    box = { width: 200, height: 10 };
    const { rerender } = render(
      <FitText testId="fit" fitKey="a" maxRatio={1} minPx={15}>
        Detektyw
      </FitText>,
    );
    expect(fitted().style.overflow).toBe('visible');
    box = { width: 200, height: 40 };
    rerender(
      <FitText testId="fit" fitKey="b" maxRatio={1} minPx={15}>
        Detektyw
      </FitText>,
    );
    expect(fitted().style.overflow).toBe('');
    expect(fontOf(fitted())).toBeGreaterThan(15);
  });
});
