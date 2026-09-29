import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ContentBlock } from '@/lib/courses-types';
import AnnotatedReplayBlock from './AnnotatedReplayBlock';
import TextLayer from './TextLayer';
import { NoteKindIcon } from '../player/notes';

// Omówienie (ANNOTATED_REPLAY, D-115), warstwa tekstu (D-114) i ikony nowych rodzajów notatek.

const recording: ContentBlock = {
  type: 'CALL_RECORDING',
  id: 'nagranie',
  segments: [
    { id: 's1', speaker: 'Dzwoniący', narration: { text: 'Ktoś włamuje się na twoje konto.' } },
    { id: 's2', speaker: 'Karol', narration: { text: 'O, te powiadomienia?' } },
    { id: 's3', speaker: 'Dzwoniący', narration: { text: 'Wpisz w aplikacji liczbę.' } },
  ],
};

const replay: ContentBlock = {
  type: 'ANNOTATED_REPLAY',
  id: 'omowienie',
  source: { kind: 'transcript', fromBlock: 'nagranie' },
  markers: [
    { n: 1, anchor: { segmentId: 's1' }, title: 'Strach', text: 'W stresie myślimy krócej.' },
    { n: 2, anchor: { segmentId: 's3' }, title: 'Parowanie liczb', text: 'Liczbę zna tylko ten, kto się loguje.' },
  ],
};

describe('AnnotatedReplayBlock', () => {
  it('transkrypcja nagrania z numerowanymi znacznikami; „Dalej” w pasku dopiero po ostatnim znaczniku, zapis { seen: N }', () => {
    const onReady = vi.fn();
    const onSubmit = vi.fn();
    const onStepChange = vi.fn();
    render(<AnnotatedReplayBlock block={replay} moduleBlocks={[recording, replay]} contentBase="/content" onReady={onReady} onSubmit={onSubmit} onStepChange={onStepChange} />);

    expect(screen.getByTestId('replay-transcript')).toHaveTextContent('O, te powiadomienia?');
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Znacznik 1 z 2');
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Strach');
    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(onStepChange).toHaveBeenLastCalledWith(0, false);

    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Parowanie liczb');
    expect(screen.getByTestId('replay-marker-2')).toHaveAttribute('aria-current', 'step');
    expect(onStepChange).toHaveBeenLastCalledWith(1, true);
    const submit = onReady.mock.calls.at(-1)?.[0] as () => void;
    expect(typeof submit).toBe('function');
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ seen: 2 });
  });

  it('strzałki ← → między znacznikami i klik w numer znacznika', () => {
    render(<AnnotatedReplayBlock block={replay} moduleBlocks={[recording, replay]} contentBase="/content" onReady={vi.fn()} onSubmit={vi.fn()} />);
    const root = screen.getByTestId('annotated-replay');
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Znacznik 2 z 2');
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Znacznik 1 z 2');
    fireEvent.click(screen.getByTestId('replay-marker-2'));
    expect(screen.getByTestId('replay-card')).toHaveTextContent('Znacznik 2 z 2');
  });

  it('klik w numer OSTATNIEGO znacznika nie zalicza pominiętych; nowy onReady rodzica nie wywołuje zgłoszenia ponownie', () => {
    const three: ContentBlock = {
      ...replay,
      markers: [...(replay.markers ?? []), { n: 3, anchor: { segmentId: 's2' }, title: 'Karol', text: 'Odpowiedź ofiary.' }],
    };
    const onReady = vi.fn();
    const { rerender } = render(<AnnotatedReplayBlock block={three} moduleBlocks={[recording, three]} contentBase="/content" onReady={onReady} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('replay-marker-3'));
    expect(onReady).toHaveBeenLastCalledWith(null);
    const calls = onReady.mock.calls.length;
    const nextOnReady = vi.fn();
    rerender(<AnnotatedReplayBlock block={three} moduleBlocks={[recording, three]} contentBase="/content" onReady={nextOnReady} onSubmit={vi.fn()} />);
    expect(onReady.mock.calls.length).toBe(calls);
    expect(nextOnReady).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('replay-marker-2'));
    expect(typeof nextOnReady.mock.calls.at(-1)?.[0]).toBe('function');
  });

  it('blok bez znaczników (wstrzymany przez API) nie zgłasza gotowości', () => {
    const onReady = vi.fn();
    render(<AnnotatedReplayBlock block={{ ...replay, markers: undefined, withheld: true }} moduleBlocks={[recording]} contentBase="/content" onReady={onReady} onSubmit={vi.fn()} />);
    expect(onReady).toHaveBeenLastCalledWith(null);
  });

  it('podgląd „Wstecz” (review) nie zgłasza gotowości ani zapisu', () => {
    const onReady = vi.fn();
    render(<AnnotatedReplayBlock block={replay} moduleBlocks={[recording, replay]} contentBase="/content" onReady={onReady} onSubmit={vi.fn()} review />);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('źródło-grafika: punkty znaczników w % grafiki', () => {
    const onImage: ContentBlock = {
      ...replay,
      source: { kind: 'image', image: 'scenes/omowienie.svg', alt: 'Omówienie rozmowy' },
      markers: [{ n: 1, anchor: { x: 25, y: 40 }, title: 'Strach', text: 'W stresie myślimy krócej.' }],
    };
    render(<AnnotatedReplayBlock block={onImage} moduleBlocks={[]} contentBase="/content" onReady={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByAltText('Omówienie rozmowy')).toHaveAttribute('src', '/content/scenes/omowienie.svg');
    expect(screen.getByTestId('replay-marker-1')).toHaveStyle({ left: '25%', top: '40%' });
  });
});

describe('TextLayer (warstwa tekstu, D-114)', () => {
  const items = [{ id: 'szyld', x: 10, y: 20, w: 30, h: 8, text: 'Księgowość', style: 'sign' as const, portrait: { x: 5, y: 50, w: 60, h: 5 } }];

  it('prostokąty w % grafiki; na wariancie pionowym - prostokąt portrait; bez warstwy nic', () => {
    const { rerender, container } = render(<TextLayer items={items} />);
    expect(screen.getByTestId('text-layer-szyld')).toHaveStyle({ left: '10%', top: '20%', width: '30%', height: '8%' });
    expect(screen.getByText('Księgowość')).toBeInTheDocument();
    rerender(<TextLayer items={items} portrait />);
    expect(screen.getByTestId('text-layer-szyld')).toHaveStyle({ left: '5%', top: '50%', width: '60%', height: '5%' });
    rerender(<TextLayer items={items} ariaHidden />);
    expect(screen.getByTestId('text-layer')).toHaveAttribute('aria-hidden', 'true');
    rerender(<TextLayer items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('NoteKindIcon: rodzaje notatek schemaVersion 6', () => {
  it.each([
    ['call', 'Rozmowa'],
    ['log', 'Logi'],
    ['web', 'Strona'],
  ])('%s ma ikonę i etykietę „%s”', (kind, label) => {
    render(<NoteKindIcon kind={kind} />);
    expect(screen.getByText(`${label}:`)).toBeInTheDocument();
  });
});
