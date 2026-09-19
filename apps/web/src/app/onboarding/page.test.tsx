import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import OnboardingPage from './page';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/onboarding',
}));

function mockCookie(value: string | undefined) {
  vi.mocked(cookies).mockReturnValue({
    get: () => (value === undefined ? undefined : { name: 'access_token', value }),
  } as unknown as ReturnType<typeof cookies>);
}

const pendingOrg = {
  id: 'o1',
  name: 'Acme',
  status: 'PENDING_DOMAIN_VERIFICATION',
  selfJoinEnabled: false,
  billing: null,
  domain: {
    name: 'acme.pl',
    verified: false,
    verifiedAt: null,
    lastCheckedAt: null,
    txtRecord: { type: 'TXT', host: '_unfooly-verify.acme.pl', value: 'unfooly-verify=abc' },
  },
};

describe('OnboardingPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('bez cookie => /login', async () => {
    mockCookie(undefined);
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('organizacja PENDING: renderuje ekran weryfikacji (dane z API, token z cookie)', async () => {
    mockCookie('tok');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => pendingOrg });
    vi.stubGlobal('fetch', fetchMock);

    render(await OnboardingPage());

    expect(screen.getByText('Zweryfikuj domenę firmy')).toBeInTheDocument();
    expect(screen.getByText('unfooly-verify=abc')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('organizacja ACTIVE => /dashboard', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...pendingOrg, status: 'ACTIVE' }) }));

    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('API 401 => /login; 403 (rola inna niż ORG_ADMIN) => /courses', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/login');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/courses');
  });

  it('awaria API: komunikat zamiast pustej strony', async () => {
    mockCookie('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    render(await OnboardingPage());

    expect(screen.getByRole('alert')).toHaveTextContent(/nie udało się załadować/i);
  });
});
