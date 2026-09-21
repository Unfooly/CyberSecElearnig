import { describe, it, expect } from 'vitest';
import { buildContentSecurityPolicy, generateNonce, resolveContentOrigin } from './security-headers';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `))
    ?.split(' ')
    .slice(1) ?? null;

describe('generateNonce', () => {
  it('zwraca 128-bitowy nonce w base64, inny przy każdym wywołaniu', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('resolveContentOrigin: tylko konkretny, bezpieczny origin', () => {
  it('przyjmuje https i zwraca sam origin (bez ścieżki i parametrów)', () => {
    expect(resolveContentOrigin('https://content.example.com/moduly/x?y=1')).toBe('https://content.example.com');
    expect(resolveContentOrigin(' https://cdn.example.com:8443/ ')).toBe('https://cdn.example.com:8443');
  });

  it.each([undefined, '', '   ', '*', 'https://*.example.com', 'https://example.com/*', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com', 'https://a.com;script-src', 'https://a.com%3Bx', 'https://a.com,b', "https://a.com'x"])(
    'odrzuca %p (zasoby modułów tylko z self)',
    (raw) => {
      expect(resolveContentOrigin(raw)).toBeNull();
    },
  );

  it('nigdy nie zwraca wartości, która mogłaby zakończyć dyrektywę CSP (brak ; , spacji i apostrofu w wyniku)', () => {
    // Znaki nowej linii/tabulatora parser URL usuwa (wynik to nieszkodliwy, sklejony host), więc też nie mogą nic wstrzyknąć.
    for (const raw of ['https://a.com;script-src', 'https://a.com%3Bx', 'https://a.com,b', "https://a.com'x", 'https://a.com\nscript-src', 'https://a.com\tb', 'https://cdn.example.com', 'https://münchen.de']) {
      const origin = resolveContentOrigin(raw);
      if (origin !== null) expect(origin).not.toMatch(/[;,'\s]/);
    }
    expect(resolveContentOrigin('https://münchen.de')).toBe('https://xn--mnchen-3ya.de');
  });

  it('http tylko dla localhost i tylko w developmencie', () => {
    expect(resolveContentOrigin('http://localhost:9000', false)).toBeNull();
    expect(resolveContentOrigin('http://localhost:9000', true)).toBe('http://localhost:9000');
    expect(resolveContentOrigin('http://example.com', true)).toBeNull();
  });
});

describe('buildContentSecurityPolicy (produkcja)', () => {
  const policy = buildContentSecurityPolicy({ nonce: 'NONCE123', contentOrigin: 'https://content.example.com' });

  it('script-src: self + nonce, BEZ unsafe-inline i unsafe-eval', () => {
    expect(directive(policy, 'script-src')).toEqual(["'self'", "'nonce-NONCE123'"]);
    expect(directive(policy, 'script-src')?.join(' ')).not.toMatch(/unsafe-/);
  });

  it('zawiera wszystkie wymagane dyrektywy z konkretnym hostem zasobów (bez wildcardów)', () => {
    expect(directive(policy, 'default-src')).toEqual(["'self'"]);
    expect(directive(policy, 'img-src')).toEqual(["'self'", 'data:', 'https://content.example.com']);
    expect(directive(policy, 'media-src')).toEqual(["'self'", 'https://content.example.com']);
    expect(directive(policy, 'connect-src')).toEqual(["'self'"]);
    expect(directive(policy, 'frame-src')).toEqual(["'self'"]);
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(policy).not.toContain('*');
  });

  it("'unsafe-inline' wyłącznie w style-src (Tailwind/atrybuty style i podglądy maili w iframe srcdoc), nigdzie indziej", () => {
    expect(directive(policy, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    const withUnsafeInline = policy.split('; ').filter((part) => part.includes("'unsafe-inline'"));
    expect(withUnsafeInline).toHaveLength(1);
    expect(withUnsafeInline[0]).toMatch(/^style-src /);
  });

  it('bez CONTENT_BASE_URL zasoby modułów tylko z self', () => {
    const local = buildContentSecurityPolicy({ nonce: 'n' });
    expect(directive(local, 'img-src')).toEqual(["'self'", 'data:']);
    expect(directive(local, 'media-src')).toEqual(["'self'"]);
  });
});

describe('buildContentSecurityPolicy (development)', () => {
  it('dodaje unsafe-eval i WebSocket dla Next dev, tylko w developmencie', () => {
    const dev = buildContentSecurityPolicy({ nonce: 'n', development: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toEqual(["'self'", 'ws:', 'wss:']);
    const prod = buildContentSecurityPolicy({ nonce: 'n' });
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('ws:');
  });
});
