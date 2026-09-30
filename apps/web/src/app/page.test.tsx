import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import HomePage, { metadata } from './page';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

function mockCookies(values: Record<string, string>) {
  vi.mocked(cookies).mockReturnValue({
    get: (name: string) => (name in values ? { name, value: values[name] } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function jwtWithRole(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'u1', email: 'a@b.pl', role, organizationId: 'o1', exp: 9999999999 })}.sig`;
}

// Film na stronie (FilmSection, D-091): jsdom nie implementuje odtwarzania mediów - atrapa, żeby nie zaśmiecać wyniku błędem jsdom.
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('HomePage (landing)', () => {
  afterEach(() => vi.mocked(redirect).mockClear());

  it('dla niezalogowanego renderuje landing: hero, sekcje, cennik z placeholderami i formularz demo', () => {
    mockCookies({});
    render(HomePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pracownicy, których nie da się nabrać.');
    expect(screen.getByRole('heading', { name: 'Trzy kroki do zespołu, który nie klika w byle co' })).toBeInTheDocument();
    expect(screen.getByText(/\[CENA\] zł/)).toBeInTheDocument();
    expect(screen.getByText(/\[KWOTA\] zł \/ rok/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Umów demo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/login');
    // Karta symulacji + dwa kafelki funkcji => pille "Wkrótce".
    expect(screen.getAllByText('Wkrótce').length).toBeGreaterThanOrEqual(3);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('ORG_ADMIN z sesją jest przekierowany do /dashboard', () => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole('ORG_ADMIN') });

    expect(() => HomePage()).toThrow('REDIRECT:/dashboard');
  });

  it('pracownik z sesją trafia do /courses (nie ma dostępu do /dashboard)', () => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole('EMPLOYEE') });

    expect(() => HomePage()).toThrow('REDIRECT:/courses');
  });

  it('sam refresh token (rola nieznana) => /courses, dostępne dla każdej roli; middleware odświeży sesję', () => {
    mockCookies({ refresh_token: 'r' });

    expect(() => HomePage()).toThrow('REDIRECT:/courses');
  });

  it.each(['SUPER_ADMIN', 'DEPARTMENT_MANAGER'])('%s trafia do /courses (middleware nie wpuszcza go na /dashboard)', (role) => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole(role) });

    expect(() => HomePage()).toThrow('REDIRECT:/courses');
  });

  it('ma metadane SEO: opis, wspólna grafika podglądu linku serwisu (D-126) i karta summary_large_image', () => {
    expect(metadata.description).toMatch(/NIS2/);
    const images = (metadata.openGraph?.images ?? []) as { url: string; width: number; height: number }[];
    expect(images[0]).toMatchObject({ url: '/og/og-unfooly.png', width: 1200, height: 630 });
    expect(metadata.openGraph).toMatchObject({ title: expect.stringMatching(/^Unfooly/), description: expect.stringMatching(/NIS2/), url: '/' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: ['/og/og-unfooly.png'] });
  });
});
