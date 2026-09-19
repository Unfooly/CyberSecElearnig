import { describe, it, expect, vi, afterEach } from 'vitest';
import { clientIpHeaders } from './client-ip';

const source = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe('clientIpHeaders', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('bez TRUST_PROXY: nic nie przekazuje i nie ufa nagłówkom (nie da się podszyć IP)', () => {
    expect(clientIpHeaders(source({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }))).toEqual({});
    vi.stubEnv('TRUST_PROXY', 'false');
    expect(clientIpHeaders(source({ 'cf-connecting-ip': '203.0.113.7' }))).toEqual({});
  });

  describe('TRUST_PROXY=true', () => {
    it('przekazuje CF-Connecting-IP', () => {
      vi.stubEnv('TRUST_PROXY', 'true');
      expect(clientIpHeaders(source({ 'cf-connecting-ip': '203.0.113.7' }))).toEqual({ 'CF-Connecting-IP': '203.0.113.7' });
    });

    it('fallback: OSTATNI hop X-Forwarded-For (lewa część jest od klienta)', () => {
      vi.stubEnv('TRUST_PROXY', 'true');
      expect(clientIpHeaders(source({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9' }))).toEqual({ 'CF-Connecting-IP': '198.51.100.9' });
    });

    it('śmieciowy CF-Connecting-IP nie ukrywa poprawnego X-Forwarded-For (i odwrotnie: poprawny CF ma pierwszeństwo)', () => {
      vi.stubEnv('TRUST_PROXY', 'true');
      expect(clientIpHeaders(source({ 'cf-connecting-ip': '1.2', 'x-forwarded-for': '198.51.100.9' }))).toEqual({
        'CF-Connecting-IP': '198.51.100.9',
      });
      expect(clientIpHeaders(source({ 'cf-connecting-ip': '2001:db8::1', 'x-forwarded-for': '198.51.100.9' }))).toEqual({
        'CF-Connecting-IP': '2001:db8::1',
      });
    });

    it.each(['<script>', 'x'.repeat(60), '', '1.2', '::::x', '12345', ':'])('odrzuca wartość niebędącą adresem: "%s"', (value) => {
      vi.stubEnv('TRUST_PROXY', 'true');
      expect(clientIpHeaders(source({ 'cf-connecting-ip': value }))).toEqual({});
    });

    it('bez nagłówków: puste', () => {
      vi.stubEnv('TRUST_PROXY', 'true');
      expect(clientIpHeaders(source({}))).toEqual({});
    });
  });
});
