import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('DEPARTMENT_MANAGER trafia do /courses (middleware nie wpuszcza go na /dashboard)', () => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole('DEPARTMENT_MANAGER') });

    expect(() => HomePage()).toThrow('REDIRECT:/courses');
  });

  // Role platformy mają własne panele (D-070) - /courses byłoby dla nich pustym ekranem klienta.
  it.each([
    ['SUPER_ADMIN', '/dashboard/admin'],
    ['RESELLER_ADMIN', '/dashboard/reseller'],
  ])('%s trafia do %s', (role, path) => {
    mockCookies({ refresh_token: 'r', access_token: jwtWithRole(role) });

    expect(() => HomePage()).toThrow(`REDIRECT:${path}`);
  });

  it('ma metadane SEO: opis i obraz OG z logo PNG', () => {
    expect(metadata.description).toMatch(/NIS2/);
    const images = (metadata.openGraph?.images ?? []) as { url: string }[];
    expect(images[0].url).toBe('/brand/png/unfooly-wordmark-1600.png');
  });
});
