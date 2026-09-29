import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccessibilitySettings from './AccessibilitySettings';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// „Bez limitów czasu” (D-124): zapis od razu przy zmianie, tylko to pole, optymistycznie z cofnięciem przy błędzie.
describe('AccessibilitySettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it('zmiana zapisuje wyłącznie noTimeLimits przez BFF i potwierdza', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    render(<AccessibilitySettings initialNoTimeLimits={false} />);
    const toggle = screen.getByRole('switch', { name: /Bez limitów czasu/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Zapisano.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/preferences', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ noTimeLimits: true }) }));
  });

  it('błąd zapisu cofa przełącznik z komunikatem; 401 - logowanie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<AccessibilitySettings initialNoTimeLimits />);
    const toggle = screen.getByRole('switch', { name: /Bez limitów czasu/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nie udało się zapisać ustawienia.'));
    expect(toggle).toBeChecked();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    fireEvent.click(toggle);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
});
