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

  it('przekierowuje do /login, gdy API zwraca 401', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(CoursesPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('pokazuje komunikat błędu (nie przekierowuje) przy 5xx/awarii sieci', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const jsx = await CoursesPage();
    render(jsx);

    expect(screen.getByText(/nie udało się załadować listy kursów/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renderuje bibliotekę z realnymi danymi z API', async () => {
    mockCookieValue('some-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
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
      }),
    );

    const jsx = await CoursesPage();
    render(jsx);

    expect(screen.getByText('Rozpoznawanie phishingu')).toBeInTheDocument();
  });
});
