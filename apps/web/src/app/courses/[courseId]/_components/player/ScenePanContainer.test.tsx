import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ScenePanContainer from './ScenePanContainer';

// jsdom nie liczy layoutu (scrollWidth/clientWidth zawsze 0) - ustawiamy je ręcznie przez Object.defineProperty, jak
// w innych testach tego repo dotykających realnych wymiarów DOM. Własny mock ResizeObserver (NIE ten z
// vitest.setup.ts - tamten to no-op, bez dostępu do callbacku) - zapamiętuje callback per obserwowany element, żeby
// testy mogły ręcznie wywołać "remeasure" tak, jak zrobiłby to prawdziwy ResizeObserver po zmianie rozmiaru.

let observedCallback: (() => void) | null = null;
let observedElements: Element[] = [];
let disconnectSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  observedCallback = null;
  observedElements = [];
  disconnectSpy = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        observedCallback = cb;
      }
      observe(el: Element) {
        observedElements.push(el);
      }
      unobserve() {}
      disconnect() {
        disconnectSpy();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setDimensions(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft = 0 }: { scrollWidth: number; clientWidth: number; scrollLeft?: number }) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  let currentScrollLeft = scrollLeft;
  Object.defineProperty(el, 'scrollLeft', {
    get: () => currentScrollLeft,
    set: (v: number) => {
      currentScrollLeft = v;
    },
    configurable: true,
  });
}

function getContainer(container: HTMLElement) {
  return container.querySelector('.scene-pan-container') as HTMLElement;
}

describe('ScenePanContainer', () => {
  it('scena mieści się bez overflow (scrollWidth<=clientWidth): canPan=false - bez cieni/podpowiedzi, dzieci renderują się normalnie', () => {
    const { container } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div data-testid="scene-content">scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    setDimensions(pan, { scrollWidth: 300, clientWidth: 300 });
    act(() => observedCallback?.());

    expect(screen.getByTestId('scene-content')).toBeInTheDocument();
    expect(container.querySelector('.scene-pan-edge')).toBeNull();
    expect(container.querySelector('.scene-pan-hint')).toBeNull();
  });

  it('panorama (scrollWidth>clientWidth): startowy scrollLeft = initialPanX * (scrollWidth-clientWidth), data-initial-pan-x na kontenerze', () => {
    const { container } = render(
      <ScenePanContainer initialPanX={0.25}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400 }); // overflow = 600
    act(() => observedCallback?.());

    expect(pan).toHaveAttribute('data-initial-pan-x', '0.25');
    expect(pan.scrollLeft).toBe(150); // 0.25 * 600
  });

  it('cienie krawędzi: lewy widoczny tylko gdy scrollLeft>0, prawy tylko gdy nie osiągnięto końca', () => {
    const { container } = render(
      <ScenePanContainer initialPanX={0}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    // initialPanX=0 -> target scrollLeft = 0, więc od razu zgodny z tym, co ustawiamy tutaj - komponent NIE
    // przypisuje scrollLeft programowo (nie ma różnicy do skorygowania), dzięki czemu kolejne fireEvent.scroll w
    // tym teście liczą się jako "user" bez potrzeby "zużywania" osobnej ochrony (patrz osobny test niżej).
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    act(() => observedCallback?.());

    // Oba divy cieni są ZAWSZE w DOM, gdy canPan - widoczność to osobna klasa "--visible" (opacity, globals.css), nie
    // obecność/brak elementu - stąd selektor wymaga OBU klas naraz, nie tylko bazowej ".scene-pan-edge--left/right".
    const leftVisible = () => container.querySelector('.scene-pan-edge--left.scene-pan-edge--visible');
    const rightVisible = () => container.querySelector('.scene-pan-edge--right.scene-pan-edge--visible');
    // scrollLeft=0: lewy cień niewidoczny (na starcie), prawy widoczny (jest gdzie panować).
    expect(leftVisible()).toBeNull();
    expect(rightVisible()).not.toBeNull();

    // User przewija do połowy - oba cienie widoczne.
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 300 });
    fireEvent.scroll(pan);
    expect(leftVisible()).not.toBeNull();
    expect(rightVisible()).not.toBeNull();

    // Koniec panoramy - prawy cień znika.
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 600 });
    fireEvent.scroll(pan);
    expect(leftVisible()).not.toBeNull();
    expect(rightVisible()).toBeNull();
  });

  it('podpowiedź "przesuń": widoczna przy starcie panoramy, znika po 3s (bez interakcji)', () => {
    vi.useFakeTimers();
    const { container } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400 });
    act(() => observedCallback?.());

    expect(container.querySelector('.scene-pan-hint')).not.toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(container.querySelector('.scene-pan-hint')).toBeNull();
  });

  it('podpowiedź znika NATYCHMIAST po prawdziwym scrollu usera (przed upływem 3s)', () => {
    vi.useFakeTimers();
    const { container } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    // scrollLeft=300 od razu zgodny z target (0.5*(1000-400)=300) - komponent NIE przypisuje scrollLeft programowo
    // przy tym pomiarze, więc poniższy fireEvent.scroll to jedyny, genuinie "user", scroll w tym teście (osobny
    // test niżej pokrywa przypadek, gdy PIERWSZY scroll to echo programowego przypisania).
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 300 });
    act(() => observedCallback?.());
    expect(container.querySelector('.scene-pan-hint')).not.toBeNull();

    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 250 });
    fireEvent.scroll(pan);
    expect(container.querySelector('.scene-pan-hint')).toBeNull();
  });

  it('sprzątanie: odmontowanie rozłącza ResizeObserver i czyści timer podpowiedzi (bez błędu przy fake timers)', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400 });
    act(() => observedCallback?.());

    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(() => act(() => vi.advanceTimersByTime(5000))).not.toThrow();
  });

  it('programowe ustawienie startowego scrollLeft (initialPanX) NIE liczy się jako panowanie usera - dopiero KOLEJNY scroll (kod review: prawdziwa przeglądarka wysyła zdarzenie "scroll" asynchronicznie po programowym scrollLeft=..., co bez tej ochrony chowało podpowiedź od razu, zanim user cokolwiek zrobił)', () => {
    vi.useFakeTimers();
    const { container } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    // scrollLeft startowe (0) RÓŻNI się od target (0.5*(1000-400)=300) - measure() musi więc SAM przypisać
    // container.scrollLeft = 300, ustawiając flagę "programmaticScrollRef" (patrz komponent).
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    act(() => observedCallback?.());
    expect(pan.scrollLeft).toBe(300);
    expect(container.querySelector('.scene-pan-hint')).not.toBeNull();

    // Symulacja "echa" zdarzenia scroll po programowym ustawieniu (ta sama wartość, którą measure() już ustawiło) -
    // pierwszy scroll PO starcie panoramy jest konsumowany przez flagę, nie liczy się jako user.
    fireEvent.scroll(pan);
    expect(container.querySelector('.scene-pan-hint')).not.toBeNull();

    // Drugi scroll (prawdziwy gest usera) - dopiero TERAZ podpowiedź znika.
    setDimensions(pan, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 320 });
    fireEvent.scroll(pan);
    expect(container.querySelector('.scene-pan-hint')).toBeNull();
  });

  it('spóźnione poznanie prawdziwych wymiarów (aspect-ratio obrazu z onLoad, PO pierwszym pomiarze) - startowa pozycja jest PRZELICZANA na nowo, dopóki user sam nie przewinął (kod review: pierwszy pomiar na domyślnym 16/10 nie miał być ostateczny)', () => {
    const { container } = render(
      <ScenePanContainer initialPanX={0.25}>
        <div>scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    // Pierwszy pomiar: brak overflow (jak przy domyślnym 16/10, zanim onLoad poznał prawdziwą proporcję).
    setDimensions(pan, { scrollWidth: 400, clientWidth: 400 });
    act(() => observedCallback?.());
    expect(container.querySelector('.scene-pan-edge')).toBeNull();

    // Obraz się załadował, --scene-ratio się zmieniło, .scene-box urósł - ResizeObserver na dziecku wywołuje
    // measure() ponownie z NOWYMI wymiarami.
    setDimensions(pan, { scrollWidth: 1200, clientWidth: 400 });
    act(() => observedCallback?.());

    expect(container.querySelector('.scene-pan-edge')).not.toBeNull();
    expect(pan.scrollLeft).toBe(200); // 0.25 * (1200-400), policzone z NOWYCH wymiarów, nie ze starych/domyślnych
  });

  it('ResizeObserver obserwuje kontener ORAZ jego pierwsze dziecko (sizowana skrzynka sceny) - łapie zmianę proporcji po poznaniu prawdziwego aspect-ratio obrazu', () => {
    const { container } = render(
      <ScenePanContainer initialPanX={0.5}>
        <div data-testid="scene-box">scena</div>
      </ScenePanContainer>,
    );
    const pan = getContainer(container);
    const child = screen.getByTestId('scene-box');
    setDimensions(pan, { scrollWidth: 400, clientWidth: 400 });
    act(() => observedCallback?.());

    expect(observedElements).toContain(pan);
    expect(observedElements).toContain(child);
  });
});
