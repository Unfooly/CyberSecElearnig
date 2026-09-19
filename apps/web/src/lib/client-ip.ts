// Bez importów z next/headers - moduł używany także w middleware (edge runtime).

/** Czy web stoi za zaufanym proxy (produkcja: Cloudflare Tunnel). Domyślnie NIE. */
export function isProxyTrusted(): boolean {
  return process.env.TRUST_PROXY === 'true';
}

// Kształt IPv4 albo IPv6 (co najmniej dwa dwukropki); pełną walidację (net.isIP) robi API.
const IPV4_LIKE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_LIKE = /^(?=(?:[^:]*:){2,})[0-9a-fA-F:.]{2,45}$/;

function isIpLike(value: string | undefined): value is string {
  return !!value && (IPV4_LIKE.test(value) || IPV6_LIKE.test(value));
}

interface HeaderSource {
  get(name: string): string | null;
}

/**
 * Nagłówki przekazujące prawdziwy adres klienta do API (BFF jest dla API jedynym
 * rozmówcą, więc bez tego limity żądań liczyłyby jeden wspólny adres).
 * TRUST_PROXY wyłączone (lokalnie) => nic nie przekazujemy i nie ufamy nagłówkom
 * przychodzącym (każdy mógłby je podszyć). Włączone => `CF-Connecting-IP`, a gdy go
 * brak, OSTATNI hop `X-Forwarded-For` (dopisany przez zaufane proxy; lewa część
 * pochodzi od klienta).
 */
export function clientIpHeaders(source: HeaderSource): Record<string, string> {
  if (!isProxyTrusted()) {
    return {};
  }
  const cf = source.get('cf-connecting-ip')?.trim();
  if (isIpLike(cf)) {
    return { 'CF-Connecting-IP': cf };
  }
  const hops = source.get('x-forwarded-for')?.split(',');
  const forwarded = hops?.[hops.length - 1]?.trim();
  return isIpLike(forwarded) ? { 'CF-Connecting-IP': forwarded } : {};
}
