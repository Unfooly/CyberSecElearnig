import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cookies, headers } from 'next/headers';
import { POST } from './route';

const setCookieMock = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

function mockHeaders(values: Record<string, string>) {
  vi.mocked(headers).mockReturnValue({ get: (name: string) => values[name.toLowerCase()] ?? null } as unknown as ReturnType<typeof headers>);
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    setCookieMock.mockClear();
    vi.mocked(cookies).mockReturnValue({ set: setCookieMock } as unknown as ReturnType<typeof cookies>);
  });

  it('z własnej strony: czyści oba cookies (maxAge 0)', async () => {
    mockHeaders({ origin: 'http://localhost:3000', host: 'localhost:3000' });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(setCookieMock).toHaveBeenCalledWith('access_token', '', expect.objectContaining({ maxAge: 0, httpOnly: true }));
    expect(setCookieMock).toHaveBeenCalledWith('refresh_token', '', expect.objectContaining({ maxAge: 0, httpOnly: true }));
  });

  it('z obcego Origin: 403 i cookies nietknięte (logout-CSRF)', async () => {
    mockHeaders({ origin: 'https://evil.example.com', host: 'localhost:3000' });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
