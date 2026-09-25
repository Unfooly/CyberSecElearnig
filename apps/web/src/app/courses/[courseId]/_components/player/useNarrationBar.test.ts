import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNarrationBar } from './useNarrationBar';

// Port z dawnego NarrationPlayer.test.tsx (usunięty razem z NarrationPlayer.tsx, feat/player-stage) - logika audio/
// napisów/autoodtwarzania jest teraz w tym hooku, prezentacja w NarrationBar.tsx/NarrationBar.test.tsx. Mapowanie w
// opisie PR. NIE przeniesione: testy przesuwania długiego napisu w czasie (ResizeObserver, pomiar scrollWidth) -
// ten mechanizm został ZASTĄPIONY zwykłym obcięciem CSS (ellipsis, "1 linia" - wymóg nowego paska), więc go nie ma.

const narration = {
  text: 'Pierwsze zdanie. Drugie zdanie.',
  audioUrl: 'audio/a.mp3',
  durationMs: 4000,
  cues: [
    { text: 'Pierwsze zdanie.', startMs: 0 },
    { text: 'Drugie zdanie.', startMs: 2000 },
  ],
};
const BASE = 'https://content.example.com';

function setup(overrides: Partial<Parameters<typeof useNarrationBar>[0]> = {}) {
  return renderHook((props: Partial<Parameters<typeof useNarrationBar>[0]> = {}) =>
    useNarrationBar({ narration, contentBase: BASE, enabled: true, resetKey: 'b1', ...overrides, ...props }),
  );
}

describe('useNarrationBar', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('składa adres z bazy i ścieżki względnej; bez autostartu bez autoPlay', () => {
    const { result } = setup();
    expect(result.current.audioUrl).toBe('https://content.example.com/audio/a.mp3');
    expect(result.current.hasAudio).toBe(true);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('niepoprawna ścieżka (obcy host, "..", schemat) - audioUrl null, hasAudio false, ale to NIE loadFailed (transkrypcja zostaje dostępna gdzie indziej)', () => {
    for (const audioUrl of ['https://evil.test/a.mp3', '../a.mp3', 'javascript:x.mp3', '//evil.test/a.mp3']) {
      const { result } = setup({ narration: { ...narration, audioUrl } });
      expect(result.current.audioUrl).toBeNull();
      expect(result.current.hasAudio).toBe(false);
    }
  });

  it('enabled=false: hasAudio false (nie zależy od poprawności adresu)', () => {
    const { result } = setup({ enabled: false });
    expect(result.current.hasAudio).toBe(false);
  });

  it('bez narracji: durationMs/captions puste, hasAudio false', () => {
    const { result } = setup({ narration: undefined });
    expect(result.current.hasAudio).toBe(false);
    expect(result.current.captions).toEqual([]);
    expect(result.current.showCaption).toBe(false);
  });

  it('togglePlay woła play()/pause() na elemencie spiętym przez audioRef', () => {
    const { result } = setup();
    const audio = document.createElement('audio');
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });

    act(() => result.current.togglePlay());
    expect(playSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    act(() => result.current.togglePlay());
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('onPlay/onPause/onEnded aktualizują playing i positionMs (onEnded ustawia na durationMs)', () => {
    const { result } = setup();
    act(() => result.current.onPlay());
    expect(result.current.playing).toBe(true);
    act(() => result.current.onPause());
    expect(result.current.playing).toBe(false);
    act(() => result.current.onEnded());
    expect(result.current.playing).toBe(false);
    expect(result.current.positionMs).toBe(4000);
  });

  it('onTimeUpdate zaokrągla sekundy do ms i zmienia aktywny napis wg cues', () => {
    const { result } = setup();
    expect(result.current.active?.text).toBe('Pierwsze zdanie.');
    act(() => result.current.onTimeUpdate(2.5));
    expect(result.current.positionMs).toBe(2500);
    expect(result.current.active?.text).toBe('Drugie zdanie.');
  });

  it('bez cues: napisy z podziału proporcjonalnego', () => {
    const { result } = setup({
      narration: { text: 'Krótkie. To jest znacznie dłuższe zdanie do podziału.', audioUrl: 'audio/a.mp3', durationMs: 10_000 },
    });
    expect(result.current.active?.text).toBe('Krótkie.');
    act(() => result.current.onTimeUpdate(9));
    expect(result.current.active?.text).toBe('To jest znacznie dłuższe zdanie do podziału.');
  });

  it('onError ustawia loadFailed (hasAudio staje się false)', () => {
    const { result } = setup();
    act(() => result.current.onError());
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.hasAudio).toBe(false);
  });

  it('AbortError z play() nie ustawia loadFailed ani autoplayBlocked', async () => {
    playSpy.mockRejectedValueOnce(new DOMException('interrupted by pause', 'AbortError'));
    const { result } = setup();
    const audio = document.createElement('audio');
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    expect(result.current.loadFailed).toBe(false);
    expect(result.current.autoplayBlocked).toBe(false);
  });

  it('NotSupportedError z play() ustawia loadFailed', async () => {
    playSpy.mockRejectedValueOnce(new DOMException('no supported source', 'NotSupportedError'));
    const { result } = setup();
    const audio = document.createElement('audio');
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });

    await act(async () => {
      result.current.togglePlay();
      await Promise.resolve();
    });

    expect(result.current.loadFailed).toBe(true);
  });

  it('seek() ustawia currentTime na elemencie i positionMs w stanie', () => {
    const { result } = setup();
    const audio = document.createElement('audio');
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });

    act(() => result.current.seek(3000));

    expect(audio.currentTime).toBe(3);
    expect(result.current.positionMs).toBe(3000);
  });

  it('wyłączenie lektora (enabled: true -> false) zatrzymuje odtwarzanie i zeruje pozycję', () => {
    const audio = document.createElement('audio');
    const { result, rerender } = renderHook((enabled: boolean) => useNarrationBar({ narration, contentBase: BASE, enabled, resetKey: 'b1' }), {
      initialProps: true,
    });
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });
    act(() => result.current.onPlay());
    act(() => result.current.onTimeUpdate(2));
    expect(result.current.playing).toBe(true);

    rerender(false);

    expect(result.current.playing).toBe(false);
    expect(result.current.positionMs).toBe(0);
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('toggleTranscript przełącza transcriptOpen', () => {
    const { result } = setup();
    expect(result.current.transcriptOpen).toBe(false);
    act(() => result.current.toggleTranscript());
    expect(result.current.transcriptOpen).toBe(true);
    act(() => result.current.toggleTranscript());
    expect(result.current.transcriptOpen).toBe(false);
  });

  it('zmiana resetKey (nowy blok) zeruje pozycję, odtwarzanie i otwartą transkrypcję', () => {
    const { result, rerender } = renderHook((resetKey: string) => useNarrationBar({ narration, contentBase: BASE, enabled: true, resetKey }), {
      initialProps: 'b1',
    });
    const audio = document.createElement('audio');
    Object.defineProperty(result.current.audioRef, 'current', { value: audio, configurable: true, writable: true });
    act(() => result.current.onPlay());
    act(() => result.current.onTimeUpdate(2.5));
    act(() => result.current.toggleTranscript());
    expect(result.current.playing).toBe(true);
    expect(result.current.transcriptOpen).toBe(true);

    rerender('b2');

    expect(result.current.playing).toBe(false);
    expect(result.current.positionMs).toBe(0);
    expect(result.current.transcriptOpen).toBe(false);
  });

  it('bez autoPlay nic nie startuje samo', () => {
    const { result } = setup({ autoPlay: false });
    void result;
    expect(playSpy).not.toHaveBeenCalled();
  });

  // Testy autoPlay Z PRAWDZIWYM elementem <audio> w DOM (audioRef musi wskazywać na coś, zanim efekt autostartu w
  // ogóle coś zrobi) są w NarrationBar.test.tsx, które renderuje pełny komponent - renderHook (ten plik) nie
  // tworzy realnego drzewa DOM, więc audioRef.current byłby null w momencie, gdy efekt montowania faktycznie biegnie.
});
