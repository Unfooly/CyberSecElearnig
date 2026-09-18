import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import CoursesPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  usePathname: () => '/courses',
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

// decodeJwtPayload (lib/jwt.ts) nie weryfikuje podpisu - wystarczy poprawny
// KSZTAŁT (3 części, drugi człon to base64url JSON z wymaganymi polami).
function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (value: string) =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

const VALID_TOKEN = fakeJwt({
  sub: 'user-1',
  organizationId: 'org-1',
  email: 'user@example.test',
  role: 'EMPLOYEE',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const gamificationResponse = {
  avatarUrl: 'fox',
  xp: 150,
  level: 2,
  nextLevelXp: 400,
  currentLevelProgressPercent: 25,
  badges: [],
};

const leaderboardResponse = [
  { rank: 1, userId: 'user-1', firstName: 'J', lastName: 'K', avatarUrl: 'fox', level: 2, xp: 150, departmentName: null },
];

describe('CoursesPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(CoursesPage()).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('przekierowuje do /login, gdy API kursów zwraca 401', async () => {
    mockCookieValue(VALID_TOKEN);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(CoursesPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('pokazuje komunikat błędu (nie przekierowuje) przy 5xx/awarii sieci listy kursów', async () => {
    mockCookieValue(VALID_TOKEN);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const jsx = await CoursesPage();
    render(jsx);

    expect(screen.getByText(/nie udało się załadować listy kursów/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renderuje bibliotekę z realnymi danymi z API, nawet gdy gamifikacja/leaderboard zawiodą', async () => {
    mockCookieValue(VALID_TOKEN);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              assignmentId: 'a1',
              courseId: 'course-1',
              title: 'Rozpoznawanie phishingu',
              category: 'EMAIL_SECURITY',
              durationMinutes: 8,
              mandatory: true,
              status: 'NOT_STARTED',
              score: null,
              dueDate: null,
              completedAt: null,
              currentBlockIndex: 0,
              totalBlocks: 4,
            },
          ],
        })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }),
    );

    const jsx = await CoursesPage();
    render(jsx);

    // Kurs pojawia się teraz DWA razy (karuzela "Twoja ścieżka nauki" +
    // biblioteka poniżej) - to zamierzone, ten sam zestaw danych renderowany
    // w dwóch widokach (patrz komentarz w courses/page.tsx).
    expect(screen.getAllByText('Rozpoznawanie phishingu').length).toBeGreaterThan(0);
  });

  it('renderuje UserGamificationCard i LeaderboardTable, gdy oba API odpowiadają poprawnie', async () => {
    mockCookieValue(VALID_TOKEN);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: true, json: async () => gamificationResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => leaderboardResponse }),
    );

    const jsx = await CoursesPage();
    render(jsx);

    expect(screen.getByText('Poziom 2')).toBeInTheDocument();
    expect(screen.getByText('150 / 400 XP')).toBeInTheDocument();
    expect(screen.getByText('Ranking organizacji')).toBeInTheDocument();
    // user-1 z leaderboardu to ten sam `sub` co w VALID_TOKEN - podświetlone jako "Ty".
    expect(screen.getByText('Ty')).toBeInTheDocument();
  });

  it('nie renderuje sekcji gamifikacji, gdy GET /users/me/gamification zawiedzie', async () => {
    mockCookieValue(VALID_TOKEN);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => leaderboardResponse }),
    );

    const jsx = await CoursesPage();
    render(jsx);

    expect(screen.queryByText(/^Poziom /)).not.toBeInTheDocument();
  });
});
