import { describe, it, expect, vi, afterEach } from 'vitest';
import { redirect } from 'next/navigation';
import { redirectIfPending } from './organization';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe('redirectIfPending', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
  });

  it('organizacja PENDING => /onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'PENDING_DOMAIN_VERIFICATION' }) }));

    await expect(redirectIfPending('tok')).rejects.toThrow('REDIRECT:/onboarding');
  });

  it.each([
    ['ACTIVE', { ok: true, json: async () => ({ status: 'ACTIVE' }) }],
    ['błąd API (np. 403 roli)', { ok: false, status: 403, json: async () => ({}) }],
  ])('%s: bez przekierowania (inny powód 403 obsługuje wywołujący)', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(redirectIfPending('tok')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
