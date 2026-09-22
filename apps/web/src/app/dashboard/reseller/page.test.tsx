import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ResellerPanelPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(() => new Headers()),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/dashboard/reseller',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

const CLIENT = {
  id: 'org-1',
  name: 'Klient Sp. z o.o.',
  status: 'ACTIVE',
  plan: 'TRIAL',
  seatsLimit: 25,
  assignedAt: '2026-09-22T10:00:00.000Z',
};

describe('ResellerPanelPage (panel partnera)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login bez cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(ResellerPanelPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('pokazuje listę obsługiwanych organizacji', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [CLIENT] }));

    render(await ResellerPanelPage());

    expect(screen.getByRole('heading', { name: 'Moi klienci', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Klient Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('bez przypisanych organizacji tłumaczy, że przypisuje je operator', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

    render(await ResellerPanelPage());

    expect(screen.getByText(/przypisuje je operator platformy/i)).toBeInTheDocument();
  });

  it('401 z API => /login', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(ResellerPanelPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('awaria API pokazuje komunikat zamiast pustej tabeli', async () => {
    mockCookieValue('token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    render(await ResellerPanelPage());

    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się załadować listy klientów.');
  });
});
