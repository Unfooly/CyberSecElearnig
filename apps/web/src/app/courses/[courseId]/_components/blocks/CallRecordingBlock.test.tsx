import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ContentBlock } from '@/lib/courses-types';
import CallRecordingBlock from './CallRecordingBlock';

// Odsłuch nagrania (CALL_RECORDING, D-115): klient wysyła wyłącznie tapnięcia (pozycja albo segment), nigdy ocenę; rozstrzygnięcie flag
// przychodzi z serwera (detail.flags).

const segment = (id: string, speaker: string, text: string, audio: boolean) => ({
  id,
  speaker,
  narration: audio ? { text, audioUrl: `audio/${id}.mp3`, durationMs: 1200 } : { text },
});

const block = (audio: boolean): ContentBlock => ({
  type: 'CALL_RECORDING',
  id: 'nagranie',
  segments: [
    { ...segment('s1', 'Dzwoniący', 'Ktoś włamuje się na twoje konto.', audio), gapAfterMs: 400 },
    segment('s2', 'Karol', 'O, te powiadomienia?', audio),
    segment('s3', 'Dzwoniący', 'Wpisz w aplikacji liczbę.', audio),
  ],
});

describe('CallRecordingBlock', () => {
  let play: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('bez nagrań (przed potokiem TTS) tylko transkrypcja: flagi przy kwestiach, zdjęcie flagi, wysyłka samych segmentów', () => {
    const onSubmit = vi.fn();
    render(<CallRecordingBlock block={block(false)} contentBase="/content" onSubmit={onSubmit} />);

    expect(screen.getByRole('tab', { name: 'Odsłuch' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Transkrypcja' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Sprawdź flagi' })).toBeDisabled();

    fireEvent.click(screen.getByTestId('recording-segment-flag-s1'));
    fireEvent.click(screen.getByTestId('recording-segment-flag-s2'));
    fireEvent.click(screen.getByTestId('recording-segment-flag-s3'));
    fireEvent.click(screen.getByTestId('recording-segment-flag-s2'));
    expect(screen.getByTestId('recording-segment-flag-s1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('recording-segment-flag-s2')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź flagi' }));
    expect(onSubmit).toHaveBeenCalledWith({ taps: [{ segmentId: 's1' }, { segmentId: 's3' }] });
  });

  it('odsłuch: F dodaje flagę w bieżącej pozycji, strzałki przewijają o 5 s (w granicach nagrania), Spacja odtwarza', () => {
    const onSubmit = vi.fn();
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={onSubmit} />);
    const root = screen.getByTestId('call-recording');
    const wave = screen.getByRole('slider', { name: 'Pozycja w nagraniu' });

    expect(screen.getByRole('tab', { name: 'Odsłuch' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(wave, { key: 'f' });
    fireEvent.keyDown(wave, { key: 'ArrowRight' });
    expect(wave).toHaveAttribute('aria-valuetext', '0:04 z 0:04');
    fireEvent.keyDown(wave, { key: 'F' });
    fireEvent.keyDown(wave, { key: 'ArrowLeft' });
    expect(wave).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getAllByTestId('recording-tap-marker')).toHaveLength(2);

    fireEvent.keyDown(wave, { key: ' ' });
    expect(play).toHaveBeenCalled();
    expect(root.querySelector('audio')?.getAttribute('src')).toBe('/content/audio/s1.mp3');
    fireEvent.keyDown(wave, { key: ' ' });
    expect(screen.getByTestId('recording-play')).toHaveAccessibleName('Odtwórz nagranie');

    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź flagi' }));
    expect(onSubmit).toHaveBeenCalledWith({ taps: [{ atMs: 0 }, { atMs: 4000 }] });
  });

  it('przycisk „Czerwona flaga” i „Cofnij flagę”; napis bieżącej kwestii po przewinięciu', () => {
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recording-flag'));
    fireEvent.click(screen.getByTestId('recording-flag'));
    expect(screen.getAllByTestId('recording-tap-marker')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Cofnij flagę/ }));
    expect(screen.getAllByTestId('recording-tap-marker')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Przewiń o 5 sekund' }));
    expect(screen.getByTestId('recording-caption')).toHaveTextContent('Wpisz w aplikacji liczbę.');
  });

  it('nagranie, które się nie wczyta, zatrzymuje odtwarzanie i przełącza na transkrypcję z komunikatem', async () => {
    play.mockRejectedValue(new Error('404'));
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recording-play'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('recording-transcript')).toHaveTextContent('Nagranie nie wczytało się');
    });
    expect(screen.getByRole('tab', { name: 'Odsłuch' })).toBeDisabled();
  });

  it('play() przerwane (AbortError - pauza, przewinięcie, zmiana trybu) to NIE awaria: odsłuch zostaje dostępny', async () => {
    play.mockRejectedValue(new DOMException('przerwane', 'AbortError'));
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('recording-play'));
    fireEvent.click(screen.getByTestId('recording-play'));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('tab', { name: 'Odsłuch' })).not.toBeDisabled();
    expect(screen.queryByTestId('recording-transcript')).not.toBeInTheDocument();
  });

  describe('maszyna stanów odtwarzania (segmenty, cisza, koniec)', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());
    const audioOf = () => screen.getByTestId('call-recording').querySelector('audio') as HTMLAudioElement;

    it('koniec segmentu -> cisza (gapAfterMs) -> następny segment -> ... -> koniec nagrania odblokowuje „Sprawdź flagi” bez flag', () => {
      const onSubmit = vi.fn();
      render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={onSubmit} />);
      fireEvent.click(screen.getByTestId('recording-play'));
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s1.mp3');

      fireEvent.ended(audioOf());
      // Cisza 400 ms po s1: jeszcze bez nowego pliku.
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s1.mp3');
      vi.advanceTimersByTime(400);
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s2.mp3');

      fireEvent.ended(audioOf());
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s3.mp3');
      expect(screen.getByRole('button', { name: 'Sprawdź flagi' })).toBeDisabled();

      fireEvent.ended(audioOf());
      expect(screen.getByTestId('recording-play')).toHaveAccessibleName('Odtwórz nagranie');
      fireEvent.click(screen.getByRole('button', { name: 'Sprawdź flagi' }));
      expect(onSubmit).toHaveBeenCalledWith({ taps: [] });
    });

    it('przewinięcie w trakcie odtwarzania przez granicę segmentu zmienia plik; Home/End na suwaku', () => {
      render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
      const wave = screen.getByRole('slider', { name: 'Pozycja w nagraniu' });
      fireEvent.click(screen.getByTestId('recording-play'));
      fireEvent.keyDown(wave, { key: 'ArrowRight' });
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s3.mp3');
      fireEvent.keyDown(wave, { key: 'Home' });
      expect(audioOf().getAttribute('src')).toBe('/content/audio/s1.mp3');
      fireEvent.click(screen.getByTestId('recording-play'));
      fireEvent.keyDown(wave, { key: 'End' });
      expect(wave).toHaveAttribute('aria-valuetext', '0:04 z 0:04');
    });

    it('odmontowanie w trakcie ciszy: timer sprzątnięty, żadnego play() po odmontowaniu', () => {
      const { unmount } = render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
      fireEvent.click(screen.getByTestId('recording-play'));
      fireEvent.ended(audioOf());
      const calls = play.mock.calls.length;
      unmount();
      vi.advanceTimersByTime(1000);
      expect(play.mock.calls.length).toBe(calls);
    });
  });

  it('limit flag (jak serwer): przycisk nieaktywny po limicie; przytrzymany F (autorepetycja) nie dodaje flag', () => {
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
    const wave = screen.getByRole('slider', { name: 'Pozycja w nagraniu' });
    fireEvent.keyDown(wave, { key: 'f', repeat: true });
    expect(screen.queryAllByTestId('recording-tap-marker')).toHaveLength(0);
    for (let i = 0; i < 205; i += 1) fireEvent.keyDown(wave, { key: 'f' });
    expect(screen.getAllByTestId('recording-tap-marker')).toHaveLength(200);
    expect(screen.getByTestId('recording-flag')).toBeDisabled();
  });

  it('strzałki na zakładkach trybu nie przewijają nagrania; transkrypcja pokazuje liczbę flag z odsłuchu', () => {
    render(<CallRecordingBlock block={block(true)} contentBase="/content" onSubmit={vi.fn()} />);
    const wave = screen.getByRole('slider', { name: 'Pozycja w nagraniu' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Odsłuch' }), { key: 'ArrowRight' });
    expect(wave).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(wave, { key: 'f' });
    fireEvent.click(screen.getByRole('tab', { name: 'Transkrypcja' }));
    expect(screen.getByTestId('recording-time-taps')).toHaveTextContent('Flagi z odsłuchu: 1');
  });

  it('wynik: każda flaga z kategorią, trafiona/przeoczona, liczba fałszywych alarmów i wynik; bez przycisku wysyłki', () => {
    render(
      <CallRecordingBlock
        block={block(true)}
        contentBase="/content"
        result={{
          detail: {
            flags: [
              { segmentId: 's1', category: 'fear', hit: true },
              { segmentId: 's3', category: 'code_request', hit: false },
            ],
            falseTaps: 1,
          },
          points: 0.4,
          reaction: { text: 'Połowa manipulacji umknęła.' },
        }}
      />,
    );
    const result = screen.getByTestId('call-recording-result');
    expect(within(result).getByRole('status')).toHaveTextContent('Trafione flagi: 1/2 · Fałszywe alarmy: 1 · Wynik: 40%');
    expect(screen.getByText('Połowa manipulacji umknęła.')).toBeInTheDocument();
    expect(screen.getByTestId('recording-result-s1')).toHaveAttribute('data-flag', 'hit');
    expect(screen.getByTestId('recording-result-s1')).toHaveTextContent('Wyłapana manipulacja: Strach');
    expect(screen.getByTestId('recording-result-s3')).toHaveTextContent('Przeoczona manipulacja: Prośba o kod');
    expect(screen.getByTestId('recording-result-s2')).toHaveAttribute('data-flag', 'none');
    expect(screen.queryByRole('button', { name: 'Sprawdź flagi' })).not.toBeInTheDocument();
  });
});
