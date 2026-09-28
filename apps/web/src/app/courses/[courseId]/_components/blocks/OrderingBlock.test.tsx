import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import OrderingBlock from './OrderingBlock';
import { HintProvider, useHints } from '../player/hints';
import type { ContentBlock } from '@/lib/courses-types';

// jsdom nie ma PointerEvent - fireEvent.pointer* tworzyłby zwykłe Event bez clientX/pointerId. Minimalny odpowiednik na MouseEvent.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

// Tablica śledcza (ORDERING, D-088). Kolejność z serwera jest potasowana, a id nieprzejrzyste: klient nie zna poprawnej.
const block: ContentBlock = {
  type: 'ORDERING',
  id: 'kolejnosc',
  prompt: 'Ułóż kroki reakcji na podejrzany mail.',
  items: [
    { id: 'x2', text: 'Zgłoś wiadomość' },
    { id: 'x3', text: 'Usuń mail' },
    { id: 'x1', text: 'Nie klikaj w link' },
  ],
  start: { label: 'A.K.', caption: 'Anna Kowalska' },
  end: { label: '−14 000 zł', caption: 'Wektor Rozliczenia' },
};

function setup(props: Partial<Parameters<typeof OrderingBlock>[0]> = {}) {
  const onSubmit = vi.fn();
  function Probe() {
    return <output data-testid="reaction">{useHints().hint ?? ''}</output>;
  }
  render(
    <HintProvider resetKey="k">
      <OrderingBlock block={block} onSubmit={onSubmit} disabled={false} caseNo="CS/2026/0915" {...props} />
      <Probe />
    </HintProvider>,
  );
  return onSubmit;
}

const tray = () => screen.getByRole('group', { name: 'Ślady do przypięcia' });
const trayCard = (text: string) => within(tray()).getByRole('button', { name: new RegExp(`^Ślad: ${text}`) });
const emptySlot = (n: number) => screen.getByRole('button', { name: new RegExp(`^Pole ${n}, puste`) });
const placed = (n: number) => screen.getByRole('button', { name: new RegExp(`^Pole ${n}: `) });
const pin = (text: string, n: number) => {
  fireEvent.click(trayCard(text));
  fireEvent.click(emptySlot(n));
};

describe('OrderingBlock: tablica śledcza', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tabliczka z numerem sprawy, zdjęcia początku i końca, puste pola 1..N, ślady na tacce w kolejności z serwera; bez "Sprawdź trop" przed zapełnieniem', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Tablica śledcza · CS/2026/0915' })).toBeInTheDocument();
    expect(screen.getByText('A.K.')).toBeInTheDocument();
    expect(screen.getByText('Wektor Rozliczenia')).toBeInTheDocument();
    for (const n of [1, 2, 3]) expect(emptySlot(n)).toBeInTheDocument();
    expect(within(tray()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Zgłoś wiadomość', 'Usuń mail', 'Nie klikaj w link']);
    expect(screen.queryByRole('button', { name: 'Sprawdź trop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Poprawna kolejność' })).not.toBeInTheDocument();
  });

  it('klik ślad -> klik pole przypina (ogłoszenie aria-live); nić: przerywana do pustych, ciągła między przypiętymi', () => {
    setup();
    const dashedBefore = document.querySelectorAll('[data-yarn="dashed"]').length;
    fireEvent.click(trayCard('Nie klikaj w link'));
    expect(trayCard('Nie klikaj w link')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(emptySlot(1));
    expect(placed(1)).toHaveTextContent('Nie klikaj w link');
    expect(within(tray()).queryByRole('button', { name: /Nie klikaj/ })).not.toBeInTheDocument();
    expect(screen.getByText('Ślad „Nie klikaj w link” przypięty do pola 1.')).toHaveAttribute('aria-live', 'polite');
    // start -> pole 1 jest teraz ciągły.
    expect(document.querySelectorAll('[data-yarn="dashed"]').length).toBe(dashedBefore - 1);
  });

  it('upuszczenie na zajęte pole = zamiana: z tacki - poprzedni ślad wraca na tackę; z pola - zamiana miejscami', () => {
    setup();
    pin('Nie klikaj w link', 1);
    fireEvent.click(trayCard('Usuń mail'));
    fireEvent.click(placed(1)); // wybrany ślad z tacki na zajęte pole
    expect(placed(1)).toHaveTextContent('Usuń mail');
    expect(trayCard('Nie klikaj w link')).toBeInTheDocument();

    pin('Nie klikaj w link', 2);
    fireEvent.click(placed(1)); // wybór przypiętego śladu
    fireEvent.click(placed(2)); // klik w zajęte pole = zamiana
    expect(placed(1)).toHaveTextContent('Nie klikaj w link');
    expect(placed(2)).toHaveTextContent('Usuń mail');
  });

  it('przypięty ślad można odłożyć na tackę; Esc anuluje wybór', () => {
    setup();
    pin('Usuń mail', 3);
    fireEvent.click(placed(3));
    fireEvent.click(screen.getByRole('button', { name: 'Odłóż na tackę' }));
    expect(emptySlot(3)).toBeInTheDocument();
    expect(trayCard('Usuń mail')).toBeInTheDocument();

    fireEvent.click(trayCard('Usuń mail'));
    fireEvent.keyDown(trayCard('Usuń mail'), { key: 'Escape' });
    expect(trayCard('Usuń mail')).toHaveAttribute('aria-pressed', 'false');
  });

  it('przeciąganie (pointer events): ślad z tacki na pole', () => {
    setup();
    const card = trayCard('Zgłoś wiadomość');
    const slot = emptySlot(2);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => slot;
    try {
      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(card, { clientX: 60, clientY: 80, pointerId: 1 });
      fireEvent.pointerUp(card, { clientX: 60, clientY: 80, pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(placed(2)).toHaveTextContent('Zgłoś wiadomość');
  });

  it('klawiatura: wybór śladu przenosi fokus na pierwsze puste pole, przypięcie - na następny ślad na tacce; Enter na pustym polu bez wyboru tylko podpowiada', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(emptySlot(1), { detail: 0 });
    expect(screen.getByText('Najpierw wybierz ślad z tacki.')).toBeInTheDocument();
    fireEvent.click(trayCard('Usuń mail'), { detail: 0 });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(emptySlot(1)).toHaveFocus();
    fireEvent.click(emptySlot(1), { detail: 0 });
    expect(placed(1)).toHaveTextContent('Usuń mail');
    expect(trayCard('Zgłoś wiadomość')).toHaveFocus();
  });

  describe('przeciąganie', () => {
    const withTarget = (target: Element | null, run: () => void) => {
      const original = document.elementFromPoint;
      document.elementFromPoint = () => target;
      try {
        run();
      } finally {
        document.elementFromPoint = original;
      }
    };
    const dragCard = (card: HTMLElement, target: Element | null) =>
      withTarget(target, () => {
        fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerMove(card, { clientX: 10, clientY: 80, pointerId: 1 });
        fireEvent.pointerUp(card, { clientX: 10, clientY: 80, pointerId: 1 });
      });

    it('po przeciągnięciu klik nie wybiera śladu; ruch poniżej progu to zwykły klik (wybór)', () => {
      vi.useFakeTimers();
      setup();
      const card = trayCard('Usuń mail');
      withTarget(null, () => {
        fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerMove(card, { clientX: 10, clientY: 80, pointerId: 1 });
        fireEvent.pointerUp(card, { clientX: 10, clientY: 80, pointerId: 1 });
        fireEvent.click(card);
      });
      expect(trayCard('Usuń mail')).toHaveAttribute('aria-pressed', 'false');
      act(() => {
        vi.advanceTimersByTime(0);
      });
      fireEvent.pointerDown(trayCard('Usuń mail'), { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(trayCard('Usuń mail'), { clientX: 12, clientY: 12, pointerId: 1 });
      fireEvent.pointerUp(trayCard('Usuń mail'), { clientX: 12, clientY: 12, pointerId: 1 });
      fireEvent.click(trayCard('Usuń mail'));
      expect(trayCard('Usuń mail')).toHaveAttribute('aria-pressed', 'true');
    });

    it('upuszczenie poza tablicą - bez zmian; na zajęte pole - zamiana; z pola na tackę - zdjęcie', () => {
      vi.useFakeTimers();
      setup();
      dragCard(trayCard('Usuń mail'), null);
      expect(trayCard('Usuń mail')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(0); // koniec tłumienia kliknięcia po przeciąganiu
      });
      pin('Nie klikaj w link', 1);
      pin('Usuń mail', 2);
      dragCard(placed(1), placed(2));
      expect(placed(1)).toHaveTextContent('Usuń mail');
      expect(placed(2)).toHaveTextContent('Nie klikaj w link');
      dragCard(placed(2), tray());
      expect(emptySlot(2)).toBeInTheDocument();
      expect(trayCard('Nie klikaj w link')).toBeInTheDocument();
    });

    it('disabled (zapis w toku): ślady nieaktywne, przeciąganie nic nie robi', () => {
      setup({ disabled: true });
      expect(trayCard('Usuń mail')).toBeDisabled();
      dragCard(trayCard('Usuń mail'), emptySlot(1));
      expect(emptySlot(1)).toBeInTheDocument();
    });
  });

  it('pełna tablica: "Sprawdź trop" (z fokusem) wysyła kolejność z pól { order }', () => {
    const onSubmit = setup();
    pin('Nie klikaj w link', 1);
    pin('Zgłoś wiadomość', 2);
    pin('Usuń mail', 3);
    const check = screen.getByRole('button', { name: 'Sprawdź trop' });
    expect(check).toHaveFocus();
    fireEvent.click(check);
    expect(onSubmit).toHaveBeenCalledWith({ order: ['x1', 'x2', 'x3'] });
  });

  it('wynik: dobre pole - zielona pinezka ✓, złe - drgnięcie; potem karty lecą na poprawne miejsca, jedno zdanie informacji zwrotnej, bez listy "Poprawna kolejność" i bez maskotki', () => {
    vi.useFakeTimers();
    setup({
      result: {
        answer: { order: ['x1', 'x3', 'x2'] },
        detail: { correctOrder: ['x1', 'x2', 'x3'] },
        correct: false,
        points: 1 / 3,
        reaction: { pose: 'thinking', text: 'Blisko. Najpierw zgłoś, potem usuń. Reszta się zgadza.' },
      },
      live: true,
    });
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'verdict');
    expect(placed(1)).toHaveAccessibleName(/na właściwym miejscu/);
    expect(placed(2)).toHaveTextContent('Usuń mail');
    expect(placed(2).querySelector('.board-card-wrong')).not.toBeNull();
    expect(document.querySelectorAll('.board-pin--good')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'settled');
    expect(placed(2)).toHaveTextContent('Zgłoś wiadomość');
    expect(placed(3)).toHaveTextContent('Usuń mail');
    expect(document.querySelectorAll('[data-yarn="dashed"]')).toHaveLength(0);
    expect(screen.getByTestId('board-feedback')).toHaveTextContent('Blisko. Najpierw zgłoś, potem usuń.');
    expect(screen.getByText(/Na właściwym miejscu: 1 z 3 · Wynik: 33%/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Poprawna kolejność' })).not.toBeInTheDocument();
    // Zdanie z reakcji jest pod tablicą - bez osobnej podpowiedzi w powłoce.
    expect(screen.getByTestId('reaction').textContent).toBe('');
    // Jeden „Dalej” (D-106): wynik bez własnego przycisku dalej - prowadzi dolny pasek.
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
  });

  it('podgląd ukończonego bloku (bez `live`): od razu stan końcowy, bez przycisku', () => {
    setup({ result: { answer: { order: ['x2', 'x1', 'x3'] }, detail: { correctOrder: ['x1', 'x2', 'x3'] }, correct: false, points: 1 / 3 } });
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'settled');
    expect(placed(1)).toHaveTextContent('Nie klikaj w link');
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
    expect(screen.getByTestId('board-feedback')).toHaveTextContent(/Nie wszystko jest na swoim miejscu/);
  });

  it('reduced-motion: od razu stan końcowy (bez werdyktu i przelotu)', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    try {
      setup({ result: { answer: { order: ['x3', 'x2', 'x1'] }, detail: { correctOrder: ['x1', 'x2', 'x3'] }, correct: false, points: 1 / 3 }, live: true });
      expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'settled');
      expect(document.querySelector('.board-fly')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('wynik bez correctOrder (starszy postęp): stan końcowy, żadna karta nie drga; zdanie z `explanation`, gdy brak reakcji', () => {
    setup({ result: { answer: { order: ['x3', 'x2', 'x1'] }, detail: { explanation: 'Najpierw nie klikaj. Potem zgłoś.' }, correct: false, points: 0 }, live: true });
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'settled');
    expect(document.querySelector('.board-card-wrong')).toBeNull();
    expect(screen.getByTestId('board-feedback')).toHaveTextContent('Najpierw nie klikaj.');
  });

  it('bez numeru sprawy i bez start/end: sama "Tablica śledcza", bez zdjęć', () => {
    setup({ caseNo: undefined, block: { ...block, start: undefined, end: undefined } });
    expect(screen.getByRole('region', { name: 'Tablica śledcza' })).toBeInTheDocument();
    expect(screen.queryByText('A.K.')).not.toBeInTheDocument();
  });
});

// Telefon w pionie (D-105, zastępuje listę z D-099): miejsce wyraźnie wyższe niż szersze -> tablica z korkiem w jednej kolumnie
// zygzakiem, tacka jako pasek pod sceną, tekst min. 15 px; palcem tylko stuknięcia.
describe('OrderingBlock: tablica zygzakiem na telefonie w pionie', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  // Region ogłoszeń bloku (Probe z setup() to też role=status - <output>).
  const live = () => screen.getAllByRole('status').find((element) => element.tagName === 'P') as HTMLElement;
  const portrait = () =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 360, height: 600, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 600, toJSON: () => ({}) }) as DOMRect);

  it('tablica z korkiem i nicią (nie lista): pola w jednej kolumnie zygzakiem, tacka POZA sceną, tekst kart i tacki min. 15 px', () => {
    portrait();
    setup();
    const board = screen.getByTestId('evidence-board');
    expect(board).toHaveAttribute('data-layout', 'zigzag');
    expect(board.querySelector('.board-cork')).not.toBeNull();
    expect(board.querySelectorAll('svg [data-yarn]').length).toBeGreaterThan(0);
    // Zygzak: sąsiednie pola na przemian przy lewej i prawej krawędzi, każde niżej od poprzedniego.
    const lefts = [1, 2, 3].map((n) => parseFloat(emptySlot(n).style.left));
    const tops = [1, 2, 3].map((n) => parseFloat(emptySlot(n).style.top));
    expect(lefts[0]).toBeLessThan(lefts[1]);
    expect(lefts[2]).toBe(lefts[0]);
    expect(tops[1]).toBeGreaterThan(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[1]);
    // Tacka - pasek pod sceną (nie w niej), karty tacki 15 px.
    expect(board).not.toContainElement(tray());
    expect(trayCard('Usuń mail')).toHaveStyle({ fontSize: '15px' });
    expect(screen.getByText('A.K.')).toBeInTheDocument();
  });

  it('karty i zdjęcia na scenie: czcionka max(15px, …) - na wąskim telefonie nie mniej niż 15 px', () => {
    portrait();
    setup();
    pin('Usuń mail', 1);
    expect(placed(1).querySelector('span')!.style.fontSize).toMatch(/^max\(15px,/);
    expect(screen.getByText('Anna Kowalska').style.fontSize).toMatch(/^max\(15px,/);
    expect(screen.getByText('Tablica śledcza · CS/2026/0915').style.fontSize).toMatch(/^max\(15px,/);
  });

  it('stuknięcie: ślad z tacki, potem pole (nie auto-przypięcie); dwa przypięte - zamiana; pełna tablica - „Sprawdź trop” wysyła kolejność', () => {
    portrait();
    const onSubmit = setup();
    fireEvent.click(trayCard('Nie klikaj w link'));
    // Samo stuknięcie śladu tylko go wybiera - pole wybiera gracz.
    expect(trayCard('Nie klikaj w link')).toHaveAttribute('aria-pressed', 'true');
    expect(emptySlot(1)).toBeInTheDocument();
    fireEvent.click(emptySlot(2));
    expect(placed(2)).toHaveTextContent('Nie klikaj w link');
    pin('Usuń mail', 1);
    pin('Zgłoś wiadomość', 3);
    // Zamiana: wybór pola 1, potem pole 3.
    fireEvent.click(placed(1));
    fireEvent.click(placed(3));
    expect(placed(1)).toHaveTextContent('Zgłoś wiadomość');
    expect(placed(3)).toHaveTextContent('Usuń mail');
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź trop' }));
    expect(onSubmit).toHaveBeenCalledWith({ order: ['x2', 'x1', 'x3'] });
  });

  it('wybór śladu z tacki przewija KONTENER SCENY (tylko w pionie) do pierwszego pustego pola poza widokiem', () => {
    // Blok i scena 360×600 od góry ekranu, pola niżej (700..780) - poza widokiem kontenera sceny.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const slot = this.hasAttribute('data-slot-index');
      return { width: 360, height: slot ? 80 : 600, x: 0, y: slot ? 700 : 0, top: slot ? 700 : 0, left: 0, right: 360, bottom: slot ? 780 : 600, toJSON: () => ({}) } as DOMRect;
    });
    setup();
    const scroll = vi.fn();
    screen.getByTestId('board-outer').scrollTo = scroll;
    // detail 1 = stuknięcie (detail 0 to aktywacja klawiaturą - fokus zamiast przewijania).
    fireEvent.click(trayCard('Zgłoś wiadomość'), { detail: 1 });
    // Pole na środku kontenera: 700 - (600 - 80) / 2; bez przewijania w poziomie (bez `left`).
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0]).toEqual({ top: 440, behavior: 'smooth' });
    // Aktywacja klawiaturą (detail 0) nie przewija - fokus przechodzi na pole (przeglądarka sama je pokaże).
    scroll.mockClear();
    fireEvent.click(trayCard('Zgłoś wiadomość'), { detail: 1 });
    fireEvent.click(trayCard('Usuń mail'), { detail: 0 });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('pole już widoczne w kontenerze sceny - bez przewijania', () => {
    portrait();
    setup();
    const scroll = vi.fn();
    screen.getByTestId('board-outer').scrollTo = scroll;
    fireEvent.click(trayCard('Zgłoś wiadomość'), { detail: 1 });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('obrót w trakcie gry: przypięte ślady zostają, przeciągany klon znika (karta zmienia rodzica - pointerup już nie przyjdzie)', () => {
    let size = { width: 1280, height: 720 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON: () => ({}) }) as DOMRect,
    );
    let resize = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    setup();
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-layout', 'u');
    pin('Usuń mail', 1);
    const card = trayCard('Zgłoś wiadomość');
    fireEvent.pointerDown(card, { pointerType: 'mouse', clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(card, { pointerType: 'mouse', clientX: 10, clientY: 80 });
    expect(document.querySelector('body > .board-card')).not.toBeNull();
    size = { width: 360, height: 600 };
    act(() => resize());
    expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-layout', 'zigzag');
    expect(document.querySelector('body > .board-card')).toBeNull();
    expect(placed(1)).toHaveTextContent('Usuń mail');
    expect(trayCard('Zgłoś wiadomość')).toBeInTheDocument();
  });

  it('wybrany przypięty ślad: „Odłóż na tackę” w pasku tacki zwraca go na tackę', () => {
    portrait();
    setup();
    pin('Usuń mail', 1);
    fireEvent.click(placed(1));
    fireEvent.click(within(tray()).getByRole('button', { name: 'Odłóż na tackę' }));
    expect(trayCard('Usuń mail')).toBeInTheDocument();
    expect(emptySlot(1)).toBeInTheDocument();
    expect(live()).toHaveTextContent('Ślad „Usuń mail” wrócił na tackę.');
  });

  it('klawiatura: wybór śladu -> fokus na pierwsze puste pole; po ostatnim przypięciu - „Sprawdź trop”; Escape anuluje wybór', () => {
    vi.useFakeTimers();
    portrait();
    setup();
    fireEvent.click(trayCard('Usuń mail'), { detail: 0 });
    act(() => {
      vi.runAllTimers();
    });
    expect(emptySlot(1)).toHaveFocus();
    fireEvent.click(emptySlot(1));
    pin('Zgłoś wiadomość', 2);
    fireEvent.click(trayCard('Nie klikaj w link'), { detail: 0 });
    fireEvent.keyDown(trayCard('Nie klikaj w link'), { key: 'Escape' });
    expect(live()).toHaveTextContent('Anulowano wybór śladu.');
    pin('Nie klikaj w link', 3);
    expect(screen.getByRole('button', { name: 'Sprawdź trop' })).toHaveFocus();
  });

  it('dotyk nie przeciąga (ruch palca przewija scenę i tackę) - tylko stuknięcia; mysz przeciąga jak na tablicy poziomej', () => {
    portrait();
    setup();
    const card = trayCard('Usuń mail');
    fireEvent.pointerDown(card, { pointerType: 'touch', clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(card, { pointerType: 'touch', clientX: 10, clientY: 80 });
    expect(document.querySelector('body > .board-card')).toBeNull();
    fireEvent.pointerDown(card, { pointerType: 'mouse', clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(card, { pointerType: 'mouse', clientX: 10, clientY: 80 });
    expect(document.querySelector('body > .board-card')).not.toBeNull();
    fireEvent.pointerCancel(card);
  });

  it('wynik: zdanie i liczba trafień NAD sceną (widoczne od razu po sprawdzeniu), bez tacki i bez własnego „Dalej” (D-106)', () => {
    portrait();
    setup({ result: { answer: { order: ['x2', 'x1', 'x3'] }, detail: { correctOrder: ['x1', 'x2', 'x3'] }, correct: false, points: 1 / 3 }, live: true });
    const result = screen.getByRole('group', { name: 'Wynik' });
    expect(result).toContainElement(screen.getByTestId('board-feedback'));
    expect(screen.queryByRole('button', { name: 'Dalej' })).not.toBeInTheDocument();
    expect(result.compareDocumentPosition(screen.getByTestId('evidence-board')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Ślady do przypięcia' })).not.toBeInTheDocument();
  });
});
