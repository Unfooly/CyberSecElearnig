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

    expect(screen.getByText(/nie udało się załadować osiągnięć/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renderuje osiągnięcia z API i licznik „zdobyte / wszystkie”', async () => {
    mockCookieValue('some-token');
    const achievement = {
      description: 'Twoja pierwsza zamknięta sprawa.',
      conditionText: 'Ukończ dowolne szkolenie.',
      lockedIcon: 'osiagniecie-pierwsza-sprawa-zablokowane',
      rank: 'MILESTONE',
      hidden: false,
      scope: 'GLOBAL',
      xpReward: 50,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { ...achievement, code: 'first-case-closed', title: 'First Case Closed', icon: 'osiagniecie-pierwsza-sprawa', isUnlocked: true, unlockedAt: '2026-09-28T10:00:00.000Z' },
          { ...achievement, code: 'flawless-case', title: 'Flawless Case', icon: 'osiagniecie-perfekcyjne-sledztwo', rank: 'LEGENDARY', isUnlocked: false, unlockedAt: null },
          { ...achievement, code: 'secret-3', title: null, description: null, conditionText: null, scope: null, hidden: true, rank: 'SECRET', icon: 'osiagniecie-tajne-zablokowane', isUnlocked: false, unlockedAt: null },
        ],
      }),
    );

    const jsx = await AchievementsPage();
    render(jsx);

    expect(screen.getAllByTestId('achievement-card')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^First Case Closed \(Milestone\), zdobyte/ })).toBeInTheDocument();
    expect(screen.getByTestId('achievements-counter')).toHaveTextContent('1 / 3');
  });

  it('ma link powrotu do /courses', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

    const jsx = await AchievementsPage();
    render(jsx);

    expect(screen.getByRole('link', { name: /wróć do kursów/i })).toHaveAttribute('href', '/courses');
  });
});
