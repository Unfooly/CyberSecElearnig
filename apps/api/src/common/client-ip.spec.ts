import { isProxyTrusted, resolveClientIp } from './client-ip';

const req = (headers: Record<string, string | string[] | undefined>, ip = '172.18.0.5') => ({ headers, ip });

describe('resolveClientIp', () => {
  describe('TRUST_PROXY wyłączone (lokalnie, bez proxy)', () => {
    it('ignoruje CF-Connecting-IP i X-Forwarded-For - liczy się adres gniazda (nie da się podszyć IP)', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }), false)).toBe('172.18.0.5');
    });

    it('bez nagłówków: adres gniazda; bez niczego: "unknown"', () => {
      expect(resolveClientIp(req({}), false)).toBe('172.18.0.5');
      expect(resolveClientIp({ headers: {} }, false)).toBe('unknown');
    });

    it('domyślnie (brak zmiennej TRUST_PROXY) proxy NIE jest zaufane', () => {
      expect(isProxyTrusted({})).toBe(false);
      expect(isProxyTrusted({ TRUST_PROXY: 'false' })).toBe(false);
      expect(isProxyTrusted({ TRUST_PROXY: '1' })).toBe(false);
      expect(isProxyTrusted({ TRUST_PROXY: 'true' })).toBe(true);
    });
  });

  describe('TRUST_PROXY=true', () => {
    it('bierze CF-Connecting-IP (IPv4 bez zmian, IPv6 jako prefiks /64)', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.7' }), true)).toBe('203.0.113.7');
      expect(resolveClientIp(req({ 'cf-connecting-ip': '2001:db8::1' }), true)).toBe('2001:db8:0:0::/64');
    });

    it('CF-Connecting-IP ma pierwszeństwo przed X-Forwarded-For', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }), true)).toBe('203.0.113.7');
    });

    it('bez CF-Connecting-IP: OSTATNI hop X-Forwarded-For (dopisany przez zaufane proxy; lewa część jest od klienta)', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9' }), true)).toBe('198.51.100.9');
      expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.9' }), true)).toBe('198.51.100.9');
    });

    it('klient nie wybiera sobie klucza przez lewą część X-Forwarded-For', () => {
      const a = resolveClientIp(req({ 'x-forwarded-for': '1.1.1.1, 198.51.100.9' }), true);
      const b = resolveClientIp(req({ 'x-forwarded-for': '2.2.2.2, 198.51.100.9' }), true);
      expect(a).toBe(b);
    });

    it.each(['nie-ip', '999.1.1.1', '203.0.113.7, 1.1.1.1', '', '<script>'])(
      'niepoprawna wartość CF-Connecting-IP "%s" jest ignorowana (fallback)',
      (value) => {
        expect(resolveClientIp(req({ 'cf-connecting-ip': value, 'x-forwarded-for': '198.51.100.9' }), true)).toBe('198.51.100.9');
        expect(resolveClientIp(req({ 'cf-connecting-ip': value }), true)).toBe('172.18.0.5');
      },
    );

    it('niepoprawny X-Forwarded-For => adres gniazda', () => {
      expect(resolveClientIp(req({ 'x-forwarded-for': 'garbage' }), true)).toBe('172.18.0.5');
    });

    it('nagłówek podany jako tablica: pierwszy element', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': ['203.0.113.7', '1.1.1.1'] }), true)).toBe('203.0.113.7');
    });
  });

  describe('IPv6: jeden klient = jeden klucz (prefiks /64)', () => {
    it('adresy z tej samej sieci /64 dają ten sam klucz - atakujący nie ma 2^64 kluczy', () => {
      const a = resolveClientIp(req({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), true);
      const b = resolveClientIp(req({ 'cf-connecting-ip': '2001:db8:1:2:1::1' }), true);
      expect(a).toBe(b);
      expect(a).toBe('2001:db8:1:2::/64');
    });

    it('inne sieci /64 dają różne klucze', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': '2001:db8:1:2::1' }), true)).not.toBe(
        resolveClientIp(req({ 'cf-connecting-ip': '2001:db8:1:3::1' }), true),
      );
    });

    it('wielkość liter i skrócenie zapisu nie tworzą nowych kluczy', () => {
      const keys = ['2001:DB8::1', '2001:db8:0:0:0:0:0:1', '2001:0db8::0001'].map((v) => resolveClientIp(req({ 'cf-connecting-ip': v }), true));
      expect(new Set(keys).size).toBe(1);
    });

    it('IPv4-mapped IPv6 to ten sam klucz co IPv4', () => {
      expect(resolveClientIp(req({ 'cf-connecting-ip': '::ffff:203.0.113.7' }), true)).toBe('203.0.113.7');
      expect(resolveClientIp(req({ 'cf-connecting-ip': '::FFFF:cb00:7107' }), true)).toBe('203.0.113.7');
    });

    it('adres gniazda też jest normalizowany (::ffff:a.b.c.d z Node) i walidowany', () => {
      expect(resolveClientIp({ headers: {}, ip: '::ffff:172.18.0.5' }, false)).toBe('172.18.0.5');
      expect(resolveClientIp({ headers: {}, ip: 'nie-ip' }, false)).toBe('unknown');
    });
  });
});
