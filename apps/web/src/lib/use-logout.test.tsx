import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useLogout } from './use-logout';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
  refreshMock.mockClear();
});

// Hook jest wspólny dla UserMenu (Topbar) i PendingHeader - testujemy go raz, na
// minimalnym komponencie, zamiast powielać te same przypadki w obu miejscach.
function Probe() {
  const { logout, isLoggingOut } = useLogout();
  return (
    <button type="button" onClick={logout} disabled={isLoggingOut}>
      {isLoggingOut ? 'Wylogowywanie...' : 'Wyloguj'}
    </button>
  );
}

describe('useLogout', () => {
  it('wysyła POST /api/auth/logout (nigdy GET) i przenosi na /login z odświeżeniem danych serwera', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('awaria sieci nie zatrzymuje wylogowania w przeglądarce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    render(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });
});
