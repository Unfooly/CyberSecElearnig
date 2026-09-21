import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNarrationPreference } from './useNarrationPreference';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ok = { ok: true, status: 200 };
const fail = { ok: false, status: 500 };

describe('useNarrationPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it('zmiana jest optymistyczna (stan od razu), a sukces ją utrwala', async () => {
    const pending = deferred<typeof ok>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    const { result } = renderHook(() => useNarrationPreference(true));

    let toggling!: Promise<void>;
    act(() => {
      toggling = result.current.toggle();
    });
    expect(result.current.enabled).toBe(false);
    expect(result.current.pending).toBe(true);

    await act(async () => {
      pending.resolve(ok);
      await toggling;
    });
    expect(result.current.enabled).toBe(false);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('błąd zapisu cofa do poprzedniej wartości z komunikatem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail));
    const { result } = renderHook(() => useNarrationPreference(true));

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.error).toMatch(/nie udało się zapisać/i);
  });

  it('wyścig: spóźniona porażka STARSZEGO żądania nie cofa nowszej zmiany', async () => {
    const first = deferred<typeof fail>();
    const second = deferred<typeof ok>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const { result } = renderHook(() => useNarrationPreference(true));

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.toggle(); // true -> false
    });
    act(() => {
      b = result.current.toggle(); // false -> true
    });
    expect(result.current.enabled).toBe(true);

    await act(async () => {
      second.resolve(ok);
      await b;
    });
    await act(async () => {
      first.resolve(fail); // starsze żądanie kończy się porażką PO nowszym
      await a;
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it('wyścig: porażka NAJNOWSZEGO żądania cofa do wartości sprzed niego (nie sprzed pierwszego)', async () => {
    const first = deferred<typeof ok>();
    const second = deferred<typeof fail>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const { result } = renderHook(() => useNarrationPreference(true));

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.toggle(); // true -> false
    });
    act(() => {
      b = result.current.toggle(); // false -> true
    });
    await act(async () => {
      first.resolve(ok);
      await a;
    });
    await act(async () => {
      second.resolve(fail);
      await b;
    });

    // Ostatnia udana wartość (po pierwszym żądaniu) to false.
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toMatch(/nie udało się zapisać/i);
  });

  it('401 przekierowuje do logowania i nie cofa zmiany', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { result } = renderHook(() => useNarrationPreference(true));

    await act(async () => {
      await result.current.toggle();
    });

    expect(pushMock).toHaveBeenCalledWith('/login');
    expect(result.current.error).toBeNull();
  });

  it('błąd sieci (fetch rzuca) cofa zmianę', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useNarrationPreference(false));

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toMatch(/nie udało się zapisać/i);
  });
});
