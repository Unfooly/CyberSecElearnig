import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import CoursePlayerPage from './page';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  usePathname: () => '/courses/course-1',
  // CoursePlayer (renderowany wewnątrz strony) woła useRouter() na wypadek
  // 401 z /progress - niepotrzebne w tych testach, ale musi być zamockowane.
  useRouter: () => ({ push: vi.fn() }),
}));

function mockCookieValue(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

const inProgressCourse = {
  assignmentId: 'a1',
  courseId: 'course-1',
  title: 'Rozpoznawanie phishingu',
  status: 'IN_PROGRESS',
  currentBlockIndex: 0,
  contentBlocks: [{ type: 'VIDEO', url: 'https://example.test/v.mp4' }],
  progress: null,
};

const completedCourse = { ...inProgressCourse, status: 'COMPLETED', currentBlockIndex: 1 };

// Przełącznik "Lektor" jest tylko w blokach z narracją (blok bez narracji nie ma rzędu odtwarzacza).
const narratedCourse = {
  ...inProgressCourse,
  contentBlocks: [
    { type: 'VIDEO', url: 'https://example.test/v.mp4', narration: { text: 'Narracja.', audioUrl: 'audio/a.mp3', durationMs: 1000 } },
  ],
};

describe('CoursePlayerPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
    vi.mocked(notFound).mockClear();
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

    await expect(CoursePlayerPage({ params: { courseId: 'course-1' } })).rejects.toThrow('REDIRECT:/onboarding');
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

    render(await CoursePlayerPage({ params: { courseId: 'course-1' } }));

    expect(redirect).not.toHaveBeenCalled();
  });

  it('przekierowuje do /login, gdy brak cookie access_token', async () => {
    mockCookieValue(undefined);

    await expect(CoursePlayerPage({ params: { courseId: 'course-1' } })).rejects.toThrow(
      'REDIRECT:/login',
    );
  });

  it('przekierowuje do /login, gdy /start zwraca 401', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(CoursePlayerPage({ params: { courseId: 'course-1' } })).rejects.toThrow(
      'REDIRECT:/login',
    );
  });

  it('wywołuje notFound(), gdy /start zwraca 404 (kurs nieprzypisany)', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );

    await expect(CoursePlayerPage({ params: { courseId: 'course-1' } })).rejects.toThrow('NOT_FOUND');
  });

  it('pokazuje komunikat błędu przy 5xx z /start, bez przekierowania', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const jsx = await CoursePlayerPage({ params: { courseId: 'course-1' } });
    render(jsx);

    expect(screen.getByText(/nie udało się załadować kursu/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('kurs IN_PROGRESS: renderuje odtwarzacz z pierwszym blokiem; zapytania tylko o start i preferencje (bez score)', async () => {
    mockCookieValue('token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => inProgressCourse });
    vi.stubGlobal('fetch', fetchMock);

    const jsx = await CoursePlayerPage({ params: { courseId: 'course-1' } });
    render(jsx);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/\/courses\/course-1\/start$/),
      expect.stringMatching(/\/users\/me\/preferences$/),
    ]);
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://example.test/v.mp4');
  });

  it('przekazuje ustawienie lektora z konta: wyłączony lektor => przełącznik "Lektor" niezaznaczony', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/users/me/preferences')
          ? { ok: true, status: 200, json: async () => ({ narrationEnabled: false }) }
          : { ok: true, status: 200, json: async () => narratedCourse },
      ),
    );

    render(await CoursePlayerPage({ params: { courseId: 'course-1' } }));

    expect(screen.getByRole('button', { name: 'Lektor' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('błąd odczytu preferencji nie blokuje kursu: domyślnie lektor włączony', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        url.endsWith('/users/me/preferences')
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => narratedCourse },
      ),
    );

    render(await CoursePlayerPage({ params: { courseId: 'course-1' } }));

    expect(screen.getByRole('button', { name: 'Lektor' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('kurs COMPLETED: dociąga wynik z /courses/my i NIE pobiera preferencji (podsumowanie nie ma odtwarzacza)', async () => {
    mockCookieValue('token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => completedCourse })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ courseId: 'course-1', score: 80 }],
      });
    vi.stubGlobal('fetch', fetchMock);

    const jsx = await CoursePlayerPage({ params: { courseId: 'course-1' } });
    render(jsx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes('/users/me/preferences'))).toBe(false);
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lektor' })).toBeNull();
  });

  it('kurs COMPLETED, /courses/my zwraca 401: przekierowuje do /login zamiast pokazać mylący wynik', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => completedCourse })
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(CoursePlayerPage({ params: { courseId: 'course-1' } })).rejects.toThrow(
      'REDIRECT:/login',
    );
  });

  it('kurs COMPLETED, /courses/my zwraca 5xx: pokazuje komunikat "nie udało się pobrać wyniku", nie fałszywe "brak pytań"', async () => {
    mockCookieValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => completedCourse })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }),
    );

    const jsx = await CoursePlayerPage({ params: { courseId: 'course-1' } });
    render(jsx);

    expect(screen.getByText(/nie udało się pobrać wyniku/i)).toBeInTheDocument();
    expect(screen.queryByText('Ten kurs nie zawierał ocenianych pytań.')).not.toBeInTheDocument();
  });
});
