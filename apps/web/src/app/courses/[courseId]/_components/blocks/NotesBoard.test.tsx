import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ContentBlock } from '@/lib/courses-types';
import NotesBoard from './NotesBoard';

// Tablica z notatkami (ORDERING look notes, D-182): kartki z notatkami, etykiety etapów pod tablicą, przypinanie klikiem i klawiaturą,
// zamiana, odkładanie, „Sprawdź trop” z kolejnością { order }, werdykt po wyniku z serwera.

const board: ContentBlock = {
  type: 'ORDERING',
  id: 'tablica',
  prompt: 'Przeciągnij etapy na kartki.',
  look: 'notes',
  background: 'assets/m/tablica.1.webp',
  // Kolejność od serwera - przetasowana, id nieprzejrzyste.
  items: [
    { id: 'x-link', text: 'Link' },
    { id: 'x-mail', text: 'E-mail' },
    { id: 'x-rozmowa', text: 'Rozmowa telefoniczna' },
  ],
  slots: [{ notes: ['Paweł dostał e-mail.'] }, { notes: ['Telefon 13 minut.'] }, { notes: ['Domena formularz-online.net.'] }],
};

// jsdom nie ma PointerEvent - zdarzenia wskaźnika bez niego nie niosą `button` ani `clientX`.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

const label = (name: string) => screen.getByRole('button', { name: new RegExp(`^Etap: ${name}`) });
const emptyCard = (n: number) => screen.getByRole('button', { name: new RegExp(`^Kartka ${n}: pusta`) });

describe('NotesBoard (D-182)', () => {
  it('kartki z notatkami i numerami, tło z contentBase, etykiety pod tablicą; bez „Sprawdź trop” przed zapełnieniem', () => {
    render(<NotesBoard block={board} contentBase="https://content.example.test" onSubmit={() => {}} />);
    const cards = screen.getAllByTestId('notes-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[1]).getByText('Telefon 13 minut.')).toBeInTheDocument();
    expect(screen.getAllByTestId('notes-slot').map((slot) => slot.textContent)).toEqual(['Przeciągnij tutaj', 'Przeciągnij tutaj', 'Przeciągnij tutaj']);
    expect(screen.getByTestId('notes-board').querySelector('img')).toHaveAttribute('src', 'https://content.example.test/assets/m/tablica.1.webp');
    expect(within(screen.getByRole('group', { name: 'Etapy ataku do przypięcia' })).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Sprawdź trop' })).toBeNull();
  });

  it('klik etykieta -> klik kartka przypina; zamiana między kartkami; „Odłóż pod tablicę”; pełna tablica wysyła kolejność kartek', () => {
    const onSubmit = vi.fn();
    render(<NotesBoard block={board} contentBase="" onSubmit={onSubmit} />);
    fireEvent.click(label('E-mail'));
    expect(label('E-mail')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(emptyCard(1));
    expect(screen.getByRole('button', { name: /^Kartka 1: E-mail/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('„E-mail” przypięty do kartki 1.');

    fireEvent.click(label('Link'));
    fireEvent.click(emptyCard(2));
    // Zamiana: wybrany „Link” z kartki 2 i klik w „E-mail” na kartce 1.
    fireEvent.click(screen.getByRole('button', { name: /^Kartka 2: Link/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Kartka 1: E-mail/ }));
    expect(screen.getByRole('button', { name: /^Kartka 1: Link/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kartka 2: E-mail/ })).toBeInTheDocument();

    // Odłożenie wybranej etykiety z kartki.
    fireEvent.click(screen.getByRole('button', { name: /^Kartka 1: Link/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Odłóż pod tablicę' }));
    expect(emptyCard(1)).toBeInTheDocument();
    expect(label('Link')).toBeInTheDocument();

    fireEvent.click(label('Link'));
    fireEvent.click(emptyCard(3));
    fireEvent.click(label('Rozmowa telefoniczna'));
    fireEvent.click(emptyCard(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź trop' }));
    expect(onSubmit).toHaveBeenCalledWith({ order: ['x-rozmowa', 'x-mail', 'x-link'] });
  });

  it('przeciągnięcie etykiety na kartkę przypina; następny klik po przeciągnięciu działa (regresja: połknięty klik)', async () => {
    render(<NotesBoard block={board} contentBase="" onSubmit={() => {}} />);
    const card = emptyCard(1);
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => [card];
    try {
      const mail = label('E-mail');
      fireEvent.pointerDown(mail, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(mail, { clientX: 40, clientY: 40, pointerId: 1 });
      fireEvent.pointerUp(mail, { clientX: 40, clientY: 40, pointerId: 1 });
    } finally {
      document.elementsFromPoint = original;
    }
    expect(screen.getByRole('button', { name: /^Kartka 1: E-mail/ })).toBeInTheDocument();
    // Przeglądarka nie wysłała `click` po przeciągnięciu - następny prawdziwy klik nie może zostać pominięty.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(label('Link'));
    expect(label('Link')).toHaveAttribute('aria-pressed', 'true');
  });

  it('klawiatura: Enter na etykiecie i Enter na kartce (te same przyciski)', () => {
    render(<NotesBoard block={board} contentBase="" onSubmit={() => {}} />);
    const mail = label('E-mail');
    mail.focus();
    fireEvent.click(mail); // Enter na <button> = click
    emptyCard(2).focus();
    fireEvent.click(emptyCard(2));
    expect(screen.getByRole('button', { name: /^Kartka 2: E-mail/ })).toBeInTheDocument();
  });

  it('wynik z serwera: werdykt na kartkach gracza (✓ / ✗), zdanie pod tablicą, potem poprawne etykiety; bez przycisków przypinania', () => {
    const result = {
      answer: { order: ['x-rozmowa', 'x-mail', 'x-link'] },
      detail: { correctOrder: ['x-mail', 'x-rozmowa', 'x-link'] },
      correct: false,
      points: 0.33,
      reaction: { text: 'Prawie. Najpierw był mail, potem rozmowa.' },
    };
    const { unmount } = render(<NotesBoard block={board} contentBase="" result={result} live />);
    const slots = screen.getAllByTestId('notes-slot');
    expect(slots.map((slot) => slot.textContent?.trim())).toEqual(['Rozmowa telefoniczna', 'E-mail', 'Link']);
    expect(screen.getAllByTestId('notes-card').map((card) => card.getAttribute('data-result'))).toEqual(['bad', 'bad', 'good']);
    expect(screen.getByTestId('board-feedback')).toHaveTextContent('Prawie. Najpierw był mail, potem rozmowa.');
    expect(screen.getByText('Na właściwym miejscu: 1 z 3')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Etapy ataku do przypięcia' })).toBeNull();
    unmount();
    // Podgląd „Wstecz” (bez live): od razu stan końcowy - poprawne etykiety na kartkach.
    render(<NotesBoard block={board} contentBase="" result={result} />);
    expect(screen.getByTestId('notes-board')).toHaveAttribute('data-phase', 'settled');
    expect(screen.getAllByTestId('notes-slot').map((slot) => slot.textContent?.trim())).toEqual(['E-mail', 'Rozmowa telefoniczna', 'Link']);
  });
});
