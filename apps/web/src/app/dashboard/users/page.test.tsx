import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import UsersPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/dashboard/users',
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('UsersPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', () => {
    mockCookieValue(undefined);

    expect(() => UsersPage()).toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renderuje Topbar i nagłówek "Zespół", gdy zalogowany', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/users/departments')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
      }),
    );

    render(UsersPage());

    expect(screen.getByRole('heading', { name: 'Zespół' })).toBeInTheDocument();
    // Czeka aż UsersPageClient (dziecko klienckie) domknie swój efekt
    // ładowania - inaczej test kończy się przed rozwiązaniem fetch(), co
    // React ostrzega jako aktualizację stanu poza act().
    await screen.findByText('Brak pracowników do wyświetlenia.');
  });
});
