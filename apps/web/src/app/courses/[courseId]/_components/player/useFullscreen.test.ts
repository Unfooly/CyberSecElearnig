import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreen } from './useFullscreen';

function stubFullscreenApi({ enabled = true }: { enabled?: boolean } = {}) {
  Object.defineProperty(document, 'fullscreenEnabled', { value: enabled, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - sprzątanie właściwości dodanej testowo na document (jsdom nie ma jej domyślnie).
  delete document.fullscreenEnabled;
  // @ts-expect-error - jw.
  delete document.fullscreenElement;
});

describe('useFullscreen', () => {
  it('enabled odzwierciedla document.fullscreenEnabled (przycisk ukryty, gdy przeglądarka/kontekst go nie wspiera)', () => {
    stubFullscreenApi({ enabled: false });
    const ref = { current: document.createElement('div') };

    const { result } = renderHook(() => useFullscreen(ref));

    expect(result.current.enabled).toBe(false);
  });

  it('toggle() na elemencie poza fullscreenem woła requestFullscreen na przekazanym ref', () => {
    stubFullscreenApi();
    const element = document.createElement('div');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    element.requestFullscreen = requestFullscreen;
    const ref = { current: element };

    const { result } = renderHook(() => useFullscreen(ref));
    act(() => result.current.toggle());

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('toggle() gdy JUŻ w fullscreenie woła document.exitFullscreen, nie requestFullscreen', () => {
    stubFullscreenApi();
    const element = document.createElement('div');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    element.requestFullscreen = requestFullscreen;
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = exitFullscreen;
    Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true });
    const ref = { current: element };

    const { result } = renderHook(() => useFullscreen(ref));
    act(() => result.current.toggle());

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('active śledzi document.fullscreenElement przez zdarzenie fullscreenchange (np. wyjście z fullscreena Escape przez samą przeglądarkę, bez wywołania toggle())', () => {
    stubFullscreenApi();
    const element = document.createElement('div');
    const ref = { current: element };

    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.active).toBe(false);

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.active).toBe(true);

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.active).toBe(false);
  });

  it('odrzucenie requestFullscreen (np. brak gestu użytkownika) nie wywala aplikacji', async () => {
    stubFullscreenApi();
    const element = document.createElement('div');
    element.requestFullscreen = vi.fn().mockRejectedValue(new Error('nope'));
    const ref = { current: element };

    const { result } = renderHook(() => useFullscreen(ref));
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });

    expect(result.current.active).toBe(false);
  });
});
