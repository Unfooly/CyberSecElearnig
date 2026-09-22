import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AccountPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(() => new Headers()),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/account',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('AccountPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(AccountPage()).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renderuje nagłówek "Ustawienia konta" i sekcję avatara z zapisanym presetem', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarUrl: 'owl' }) }));

    render(await AccountPage());

    expect(screen.getByRole('heading', { name: 'Ustawienia konta', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Avatar', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'owl' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('przekierowuje do /login, gdy API odrzuca token (401)', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(AccountPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('awaria API (5xx) nie blokuje ekranu - sekcja avatara renderuje się bez zaznaczonego presetu', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(await AccountPage());

    expect(screen.getByRole('heading', { name: 'Avatar', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });
});
