import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PopupsEasterEgg, { countdownSeconds, formatCountdown, spokenTitle, type PopupsHandle } from './PopupsEasterEgg';
import type { PopupItem } from '@/lib/courses-types';

// jsdom nie ma PointerEvent - fireEvent.pointerEnter tworzyłby zwykłe Event bez pointerType. Minimalny odpowiednik na MouseEvent.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

// Easter egg (D-100): okienka zamykane tylko krzyżykiem, po wszystkich - outro i wyróżnienie.
const items: PopupItem[] = [
  { title: '⚠ Wykryto 147 wirusów!', body: 'Twój komputer jest bardzo chory.', button: 'Wylecz za 0 zł', behavior: 'dodge' },
  { title: '🎉 Gratulacje!', body: 'Wygrałeś smartfon!', button: 'Odbierz nagrodę' },
  { title: '🔒 Pliki zaszyfrowane', body: 'Zapłać, żeby je odzyskać.', button: 'Zapłać teraz', countdown: '23:59:59' },
];

function setup(reducedMotion = false, extra: { backLabel?: string; alreadyFound?: boolean } = {}) {
  const onFound = vi.fn();
  const onDone = vi.fn();
  const ref = createRef<PopupsHandle>();
  render(
    <PopupsEasterEgg
      ref={ref}
      items={items}
      outro="Pirackie gry to częsta droga wirusów do firm."
      badge={{ id: 'ciekawski-detektyw', label: 'Curious Detective' }}
      reducedMotion={reducedMotion}
      onFound={onFound}
      onDone={onDone}
      {...extra}
    />,
  );
  return { onFound, onDone, ref };
}

const popups = () => screen.queryAllByRole('dialog');
// Etykieta krzyżyka bez ozdobnego symbolu z początku tytułu.
const closeButton = (title: string) => screen.getByRole('button', { name: `Zamknij okienko: ${spokenTitle(title)}` });
const closeAll = () => {
  for (const item of [...items].reverse()) fireEvent.click(closeButton(item.title));
};

describe('PopupsEasterEgg', () => {
  afterEach(() => vi.useRealTimers());

  it('okienka wyskakują kolejno co 350 ms; fokus zawsze na krzyżyku górnego', () => {
    vi.useFakeTimers();
    setup();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(popups()).toHaveLength(1);
    expect(closeButton(items[0].title)).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(popups()).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(popups()).toHaveLength(3);
    expect(closeButton(items[2].title)).toHaveFocus();
    expect(screen.getByRole('dialog', { name: items[2].title })).toHaveAccessibleDescription('Zapłać, żeby je odzyskać.');
  });

  it('reduced-motion: wszystkie okienka od razu, bez mrugnięcia i animacji wejścia', () => {
    setup(true);
    expect(popups()).toHaveLength(3);
    expect(document.querySelector('.popup-blink, .popup-in')).toBeNull();
  });

  it('przycisk w okienku go nie zamyka (okienko drga); zamyka tylko krzyżyk', () => {
    setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Odbierz nagrodę' }));
    expect(popups()).toHaveLength(3);
    fireEvent.click(closeButton(items[1].title));
    expect(popups()).toHaveLength(2);
    expect(closeButton(items[2].title)).toHaveFocus();
  });

  it('dodge: ucieka przed myszą maks. 2 razy, nie na dotyku', () => {
    vi.useFakeTimers();
    setup(false);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const button = screen.getByRole('button', { name: 'Wylecz za 0 zł' });
    fireEvent.pointerEnter(button, { pointerType: 'touch' });
    expect(button.style.transform).toBe('translate(0px, 0px)');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    const first = button.style.transform;
    expect(first).not.toBe('translate(0px, 0px)');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    const second = button.style.transform;
    expect(second).not.toBe(first);
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(button.style.transform).toBe(second);
  });

  it('dodge wyłączone przy reduced-motion', () => {
    setup(true);
    const button = screen.getByRole('button', { name: 'Wylecz za 0 zł' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(button.style.transform).toBe('translate(0px, 0px)');
  });

  it('odliczanie tyka w dół co sekundę (kosmetyczne), czytnik ma stały opis', () => {
    vi.useFakeTimers();
    setup(true);
    const countdown = screen.getByTestId('easter-countdown');
    expect(countdown).toHaveTextContent('23:59:59');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(countdown).toHaveTextContent('23:59:56');
    expect(countdown).toHaveTextContent('Odliczanie od 23:59:59');
  });

  it('po zamknięciu wszystkich: onFound raz, outro z wyróżnieniem w STAŁYM regionie live, przycisk powrotu woła onDone', () => {
    const { onFound, onDone } = setup(true, { backLabel: 'Wróć do pulpitu' });
    // Region live istnieje od montowania (pusty) - czytnik ogłasza jego wypełnienie.
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('');
    closeAll();
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBe(live);
    expect(live).toHaveTextContent('Pirackie gry to częsta droga wirusów do firm. Nowe osiągnięcie: Curious Detective');
    expect(screen.getByTestId('easter-badge')).toHaveTextContent('Nowe osiągnięcie: Curious Detective');
    const back = screen.getByRole('button', { name: 'Wróć do pulpitu' });
    expect(back).toHaveFocus();
    fireEvent.click(back);
    expect(onDone).toHaveBeenCalled();
  });

  it('ponowne otwarcie po znalezieniu: „Osiągnięcie” (bez „Nowe”); domyślny przycisk „Wróć”', () => {
    setup(true, { alreadyFound: true });
    closeAll();
    expect(screen.getByTestId('easter-badge')).toHaveTextContent(/^Osiągnięcie: Curious Detective$/);
    expect(screen.getByRole('button', { name: 'Wróć' })).toBeInTheDocument();
  });

  it('spokenTitle: bez ozdobnych symboli na początku', () => {
    expect(spokenTitle('⚠ Wykryto 147 wirusów!')).toBe('Wykryto 147 wirusów!');
    expect(spokenTitle('🎉 Gratulacje!')).toBe('Gratulacje!');
    expect(spokenTitle('147 wirusów')).toBe('147 wirusów');
    expect(spokenTitle('!!!')).toBe('!!!');
  });

  it('uchwyt: closeTop zamyka górne okienko (Esc), pending do zamknięcia wszystkich', () => {
    const { ref } = setup(true);
    expect(ref.current?.pending()).toBe(true);
    act(() => {
      ref.current?.closeTop();
    });
    expect(popups()).toHaveLength(2);
    expect(screen.queryByRole('dialog', { name: items[2].title })).toBeNull();
    // Każde Esc to osobne zdarzenie (render między nimi - uchwyt zna aktualne górne okienko).
    act(() => {
      ref.current?.closeTop();
    });
    act(() => {
      ref.current?.closeTop();
    });
    expect(ref.current?.pending()).toBe(false);
    expect(ref.current?.closeTop()).toBe(false);
  });

  it('countdownSeconds / formatCountdown', () => {
    expect(countdownSeconds('23:59:59')).toBe(86399);
    expect(countdownSeconds('0:10:00')).toBe(600);
    expect(formatCountdown(86399)).toBe('23:59:59');
    expect(formatCountdown(5)).toBe('00:00:05');
    expect(formatCountdown(-3)).toBe('00:00:00');
  });
});
