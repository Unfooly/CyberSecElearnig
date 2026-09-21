import { describe, it, expect } from 'vitest';
// @ts-expect-error konfiguracja Next to plik .mjs bez deklaracji typów
import nextConfig from '../../next.config.mjs';

type Rule = { source: string; headers: { key: string; value: string }[] };

// Wyjątek od globalnego X-Frame-Options: DENY jest JEDYNY i dotyczy wyłącznie dokumentu EMBEDDED_HTML (osadzanego przez naszą stronę).
// Test pilnuje, że nikt go nie poszerza (np. do /api/:path*) ani nie przestawia kolejności (reguła wyjątku musi być po globalnej).
describe('next.config.mjs: nagłówki X-Frame-Options', () => {
  it('globalnie DENY; dokładnie jeden wyjątek SAMEORIGIN, tylko dla trasy embed, po regule globalnej', async () => {
    const rules = (await nextConfig.headers()) as Rule[];
    const xfo = (rule: Rule) => rule.headers.find((header) => header.key === 'X-Frame-Options')?.value;

    const withXfo = rules.filter((rule) => xfo(rule) !== undefined);
    const global = withXfo.filter((rule) => rule.source === '/:path*');
    expect(global).toHaveLength(1);
    expect(xfo(global[0])).toBe('DENY');

    const exceptions = withXfo.filter((rule) => xfo(rule) === 'SAMEORIGIN');
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].source).toBe('/api/courses/:courseId/blocks/:blockId/embed');
    expect(rules.indexOf(exceptions[0])).toBeGreaterThan(rules.indexOf(global[0]));

    // Żadna inna reguła nie zmienia X-Frame-Options.
    expect(withXfo).toHaveLength(2);
  });
});
