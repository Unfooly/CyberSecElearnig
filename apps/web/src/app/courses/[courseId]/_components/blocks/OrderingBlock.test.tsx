import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import OrderingBlock from './OrderingBlock';
import { MascotReactionProvider, useMascotReaction } from '../player/mascot-reaction';
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
    return <output data-testid="reaction">{useMascotReaction().reaction?.pose ?? ''}</output>;
  }
  render(
    <MascotReactionProvider resetKey="k">
      <OrderingBlock block={block} onSubmit={onSubmit} disabled={false} caseNo="CS/2026/0915" {...props} />
      <Probe />
    </MascotReactionProvider>,
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
    const onContinue = vi.fn();
    setup({
      result: {
        answer: { order: ['x1', 'x3', 'x2'] },
        detail: { correctOrder: ['x1', 'x2', 'x3'] },
        correct: false,
        points: 1 / 3,
        reaction: { pose: 'thinking', text: 'Blisko. Najpierw zgłoś, potem usuń. Reszta się zgadza.' },
      },
      onContinue,
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
    expect(screen.getByTestId('reaction')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(onContinue).toHaveBeenCalled();
  });

  it('podgląd ukończonego bloku (bez "Dalej"): od razu stan końcowy, bez przycisku', () => {
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
      setup({ result: { answer: { order: ['x3', 'x2', 'x1'] }, detail: { correctOrder: ['x1', 'x2', 'x3'] }, correct: false, points: 1 / 3 }, onContinue: vi.fn() });
      expect(screen.getByTestId('evidence-board')).toHaveAttribute('data-phase', 'settled');
      expect(document.querySelector('.board-fly')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('wynik bez correctOrder (starszy postęp): stan końcowy, żadna karta nie drga; zdanie z `explanation`, gdy brak reakcji', () => {
    setup({ result: { answer: { order: ['x3', 'x2', 'x1'] }, detail: { explanation: 'Najpierw nie klikaj. Potem zgłoś.' }, correct: false, points: 0 }, onContinue: vi.fn() });
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
