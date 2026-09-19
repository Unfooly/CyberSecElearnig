// Publiczne (darmowe, konsumenckie) domeny e-mail. Rejestracja firmy wymaga
// adresu w domenie firmowej, bo właściciel domeny jest weryfikowany rekordem
// DNS (niemożliwe dla gmail.com itp.). Lista jest w kodzie i łatwa do
// rozszerzenia: dopisz domenę małymi literami (ASCII/punycode) do tablicy.
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  // Google
  'gmail.com',
  'googlemail.com',
  // Polskie
  'wp.pl',
  'wp.eu',
  'o2.pl',
  'tlen.pl',
  'onet.pl',
  'onet.eu',
  'op.pl',
  'interia.pl',
  'interia.eu',
  'poczta.fm',
  'poczta.onet.pl',
  'gazeta.pl',
  'go2.pl',
  'vp.pl',
  'buziaczek.pl',
  'autograf.pl',
  'spoko.pl',
  'amorki.pl',
  'adres.pl',
  // Microsoft
  'outlook.com',
  'outlook.pl',
  'hotmail.com',
  'hotmail.pl',
  'live.com',
  'msn.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',
  // Yahoo / AOL
  'yahoo.com',
  'yahoo.pl',
  'yahoo.co.uk',
  'ymail.com',
  'aol.com',
  // Inne
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'tutanota.com',
  'tuta.io',
  'fastmail.com',
  'hey.com',
];

const PUBLIC_EMAIL_DOMAIN_SET = new Set(PUBLIC_EMAIL_DOMAINS);

// TLD sieci wewnętrznych: nie da się na nich udowodnić własności domeny w
// publicznym DNS, a weryfikacja odpytywałaby wewnętrzny DNS serwera.
export const INTERNAL_TLDS: readonly string[] = ['local', 'internal', 'corp', 'lan'];

const INTERNAL_TLD_SET = new Set(INTERNAL_TLDS);

/** Oczekuje domeny znormalizowanej (małe litery, ASCII/punycode, bez końcowej kropki). */
export function hasInternalTld(domain: string): boolean {
  return INTERNAL_TLD_SET.has(domain.slice(domain.lastIndexOf('.') + 1));
}

/** Oczekuje domeny znormalizowanej (małe litery, ASCII/punycode, bez końcowej kropki). */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAIN_SET.has(domain);
}
