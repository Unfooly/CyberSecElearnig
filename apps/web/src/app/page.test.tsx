import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import HomePage, { generateMetadata } from './page';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
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

function mockAcceptLanguage(value: string | null) {
  vi.mocked(headers).mockReturnValue(new Headers(value ? { 'accept-language': value } : {}) as unknown as ReturnType<typeof headers>);
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
  // Flaga ustawiona w powłoce dewelopera nie może zmienić wyniku testów landingu.
  beforeEach(() => vi.stubEnv('COMING_SOON', ''));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(redirect).mockClear();
  });

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
    const metadata = generateMetadata();
    expect(metadata.description).toMatch(/NIS2/);
    const images = (metadata.openGraph?.images ?? []) as { url: string; width: number; height: number }[];
    expect(images[0]).toMatchObject({ url: '/og/og-unfooly.png', width: 1200, height: 630 });
    expect(metadata.openGraph).toMatchObject({ title: expect.stringMatching(/^Unfooly/), description: expect.stringMatching(/NIS2/), url: '/' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: ['/og/og-unfooly.png'] });
  });

  it('bez flagi COMING_SOON (także "0") „/” to pełny landing', () => {
    vi.stubEnv('COMING_SOON', '0');
    mockCookies({});
    mockAcceptLanguage('pl-PL');
    render(HomePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pracownicy, których nie da się nabrać.');
    expect(screen.queryByTestId('coming-soon-video')).not.toBeInTheDocument();
  });
});

describe('HomePage ze stroną „w budowie” (COMING_SOON=1, D-157)', () => {
  beforeEach(() => vi.stubEnv('COMING_SOON', '1'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(redirect).mockClear();
  });

  it('niezalogowany z polską przeglądarką: tekst PL, link „Zaloguj się” do /login, bez landingu', () => {
    mockCookies({});
    mockAcceptLanguage('pl-PL,pl;q=0.9,en;q=0.8');
    const { container } = render(HomePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Strona w budowie. Startujemy wkrótce.');
    expect(screen.getByText('Szkolenia z cyberbezpieczeństwa, po których nikt nie da się nabrać.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Umów demo' })).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('lang', 'pl');
    expect(container.querySelector('script')).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('wideo: autoplay, wyciszone, pętla, playsinline, plakat, aria-hidden, źródła z /coming-soon/; plakat zastępczy bez alt', () => {
    mockCookies({});
    mockAcceptLanguage('pl');
    render(HomePage());

    const video = screen.getByTestId('coming-soon-video') as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('aria-hidden', 'true');
    expect(video).toHaveAttribute('poster', '/coming-soon/unfooly-loader-poster.jpg');
    expect(video.className).toMatch(/motion-reduce:hidden/);
    expect([...video.querySelectorAll('source')].map((s) => s.getAttribute('src'))).toEqual([
      '/coming-soon/unfooly-loader.webm',
      '/coming-soon/unfooly-loader.mp4',
    ]);
    const poster = screen.getByTestId('coming-soon-poster');
    expect(poster).toHaveAttribute('alt', '');
    expect(poster).toHaveAttribute('aria-hidden', 'true');
    expect(poster.className).toMatch(/hidden.*motion-reduce:block/);
  });

  it.each([['en-US,en;q=0.9'], ['de-DE'], [null]])('przeglądarka inna niż polska (%s): tekst EN, „Log in” do /login', (accept) => {
    mockCookies({});
    mockAcceptLanguage(accept);
    const { container } = render(HomePage());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Under construction. Launching soon.');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(container.firstElementChild).toHaveAttribute('lang', 'en');
  });

  it.each([
    ['ORG_ADMIN', '/dashboard'],
    ['EMPLOYEE', '/courses'],
  ])('zalogowany %s nie widzi strony „w budowie” - trafia na %s', (role, path) => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole(role) });
    mockAcceptLanguage('pl');

    expect(() => HomePage()).toThrow(`REDIRECT:${path}`);
  });

  it('metadane: tytuł karty i opis „wkrótce” w języku przeglądarki, podgląd linku (og/twitter) ogólny jak bez flagi', () => {
    mockAcceptLanguage('pl-PL');
    const pl = generateMetadata();
    expect(pl.title).toEqual({ absolute: 'Unfooly – wkrótce' });
    expect(pl.description).toMatch(/Startujemy wkrótce/);
    mockAcceptLanguage('en-GB');
    expect(generateMetadata().title).toEqual({ absolute: 'Unfooly – coming soon' });

    vi.stubEnv('COMING_SOON', '');
    const plain = generateMetadata();
    expect(pl.openGraph).toEqual(plain.openGraph);
    expect(pl.twitter).toEqual(plain.twitter);
    expect(pl.openGraph).toMatchObject({ description: expect.stringMatching(/NIS2/) });
  });
});
