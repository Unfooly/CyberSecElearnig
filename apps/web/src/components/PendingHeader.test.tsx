import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PendingHeader from './PendingHeader';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  usePathname: () => '/onboarding',
}));

describe('PendingHeader', () => {
  it('pokazuje tylko ekrany dostępne dla organizacji PENDING (bez linków do zablokowanych stron)', () => {
    render(<PendingHeader />);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/onboarding', '/dashboard/settings']);
    expect(screen.getByRole('link', { name: 'Weryfikacja domeny' })).toHaveAttribute('aria-current', 'page');
  });

  it('"Wyloguj" wysyła POST /api/auth/logout i przenosi na /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<PendingHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

  it('nawet gdy żądanie wylogowania padnie, użytkownik trafia na /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    pushMock.mockClear();
    render(<PendingHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });
});
