import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AVATAR_CHANGED_EVENT } from '@/lib/avatar-events';
import { useMyAvatar } from './use-my-avatar';

// Wydzielone z Topbar.test.tsx (fix/dialogue-polish) - useMyAvatar jest teraz wspólną logiką Topbar/odtwarzacza
// kursu, więc dostaje własny zestaw testów jednostkowych zamiast polegać wyłącznie na testach Topbar.tsx.
describe('useMyAvatar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bez userEmail nie odpytuje API - avatarUrl zostaje null', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useMyAvatar(null));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.avatarUrl).toBeNull();
  });

  it('pobiera avatar RAZ na dany userEmail', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'fox' }) });
    vi.stubGlobal('fetch', fetchSpy);

    const { result, rerender } = renderHook(({ email }) => useMyAvatar(email), { initialProps: { email: 'a@example.com' } });

    await waitFor(() => expect(result.current.avatarUrl).toBe('fox'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/users/me/avatar');

    // Re-render z TYM SAMYM userEmail nie wywołuje kolejnego żądania.
    rerender({ email: 'a@example.com' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('zmiana userEmail pobiera ponownie (nowy user nie widzi avatara poprzedniego do czasu odpowiedzi)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'fox' }) });
    vi.stubGlobal('fetch', fetchSpy);

    const { result, rerender } = renderHook(({ email }) => useMyAvatar(email), { initialProps: { email: 'a@example.com' } });
    await waitFor(() => expect(result.current.avatarUrl).toBe('fox'));

    rerender({ email: 'b@example.com' });
    expect(result.current.avatarUrl).toBeNull();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('AVATAR_CHANGED_EVENT aktualizuje stan od razu, bez przeładowania', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: null }) }));

    const { result } = renderHook(() => useMyAvatar('a@example.com'));
    await waitFor(() => expect(result.current.avatarUrl).toBeNull());

    act(() => {
      window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: 'fox' }));
    });

    expect(result.current.avatarUrl).toBe('fox');
  });

  it('błąd sieci (fetch reject) przy pobieraniu avatara zostawia avatarUrl null (inicjały jako fallback po stronie wywołującego) - odróżnione od "brak fetch" przez asercję na jego wywołanie', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useMyAvatar('a@example.com'));
    await act(async () => {
      await Promise.resolve().catch(() => {});
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.avatarUrl).toBeNull();
  });

  it('status nie-ok (np. 401) przy pobieraniu avatara zostawia avatarUrl null, tak samo jak błąd sieci', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ avatarUrl: 'fox' }) });
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useMyAvatar('a@example.com'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // `ok: false` musi zostać zignorowane, NIE odczytane jako sukces - inaczej odczytalibyśmy `data.avatarUrl` z
    // ciała odpowiedzi błędu (tu celowo ustawione na 'fox', żeby test faktycznie odróżniał "przeczytane body błędu"
    // od "zignorowane body błędu").
    expect(result.current.avatarUrl).toBeNull();
  });
});
