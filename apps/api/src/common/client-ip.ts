import { isIP } from 'net';

/** Czy API jest za zaufanym proxy (Cloudflare Tunnel -> web/BFF -> api). Czytane przy każdym użyciu (env). */
export function isProxyTrusted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRUST_PROXY === 'true';
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Rozwija IPv6 do 8 grup 16-bitowych (obsługuje "::" i końcówkę IPv4); null gdy niepoprawny. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) {
    text = text.slice(0, zone);
  }
  // Końcówka IPv4 (np. ::ffff:1.2.3.4) -> dwie grupy hex.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Klucz limitu dla poprawnego adresu IP:
 * - IPv4 bez zmian; IPv4-mapped IPv6 (::ffff:a.b.c.d) sprowadzone do IPv4 (jeden klient = jeden klucz),
 * - IPv6 sprowadzone do prefiksu /64 (pojedyncza sieć klienta to 2^64 adresów - bez tego
 *   atakujący miałby nieograniczoną liczbę kluczy i omijał limity oraz rozdymał pamięć throttlera).
 */
export function limitKeyForIp(address: string): string {
  if (isIP(address) === 4) {
    return address;
  }
  const groups = expandIpv6(address);
  if (!groups) {
    return address;
  }
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isV4Mapped) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/**
 * Adres klienta do limitów żądań (throttler).
 *
 * - `TRUST_PROXY=true`: `CF-Connecting-IP` (Cloudflare; przekazywany przez BFF w
 *   `apps/web`), a gdy go brak - OSTATNI hop `X-Forwarded-For` (ten dopisany przez
 *   zaufane proxy; lewa część należy do klienta i może być dowolna). Wartość musi
 *   być poprawnym adresem IP, inaczej jest ignorowana.
 * - `TRUST_PROXY` inne niż `true` (lokalnie, bez proxy): nagłówki są IGNOROWANE,
 *   liczy się adres gniazda - inaczej każdy mógłby podszyć IP i ominąć limit.
 *
 * Bezpieczne tylko wtedy, gdy przed api stoi wyłącznie zaufane proxy, a
 * `CF-Connecting-IP` nie pochodzi od klienta (Cloudflare go nadpisuje; Caddy w
 * Caddyfile ustawia go z {remote_host}). Wystawienie api na zewnątrz przy
 * TRUST_PROXY=true pozwala podszywać się pod IP - nie rób tego.
 */
export function resolveClientIp(req: RequestLike, trustProxy: boolean = isProxyTrusted()): string {
  const socketCandidate = req.ip ?? req.socket?.remoteAddress ?? '';
  const socketIp = isIP(socketCandidate) ? limitKeyForIp(socketCandidate) : 'unknown';
  if (!trustProxy) {
    return socketIp;
  }

  const cf = firstHeader(req.headers['cf-connecting-ip'])?.trim();
  if (cf && isIP(cf)) {
    return limitKeyForIp(cf);
  }
  const hops = firstHeader(req.headers['x-forwarded-for'])?.split(',');
  const forwarded = hops?.[hops.length - 1]?.trim();
  if (forwarded && isIP(forwarded)) {
    return limitKeyForIp(forwarded);
  }
  return socketIp;
}
