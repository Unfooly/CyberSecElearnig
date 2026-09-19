import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AchievementsPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/courses/achievements',
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

describe('AchievementsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(AchievementsPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('przekierowuje do /login, gdy API zwraca 401', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(AchievementsPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('403 z guarda organizacji PENDING => /onboarding (stan potwierdzony w /organization/me)', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/organization/me')
          ? { ok: true, status: 200, json: async () => ({ status: 'PENDING_DOMAIN_VERIFICATION' }) }
          : { ok: false, status: 403, json: async () => ({}) },
      ),
    );

    await expect(AchievementsPage()).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('403 z innego powodu (organizacja ACTIVE) nie przekierowuje na onboarding', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/organization/me')
          ? { ok: true, status: 200, json: async () => ({ status: 'ACTIVE' }) }
          : { ok: false, status: 403, json: async () => ({}) },
      ),
    );

    render(await AchievementsPage());

    expect(redirect).not.toHaveBeenCalled();
  });

  it('pokazuje komunikat błędu (nie przekierowuje) przy 5xx/awarii sieci', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const jsx = await AchievementsPage();
    render(jsx);

    expect(screen.getByText(/nie udało się załadować odznak/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renderuje odznaki z realnymi danymi z API', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            code: 'FIRST_STEP',
            title: 'Pierwszy Krok',
            description: 'Ukończono pierwszy kurs.',
            icon: 'first-step',
            xpReward: 50,
            isUnlocked: true,
            unlockedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const jsx = await AchievementsPage();
    render(jsx);

    expect(screen.getByText('Pierwszy Krok')).toBeInTheDocument();
  });

  it('ma link powrotu do /courses', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

    const jsx = await AchievementsPage();
    render(jsx);

    expect(screen.getByRole('link', { name: /wróć do kursów/i })).toHaveAttribute('href', '/courses');
  });
});
