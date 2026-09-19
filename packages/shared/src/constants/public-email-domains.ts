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

/** Oczekuje domeny znormalizowanej (małe litery, ASCII/punycode, bez końcowej kropki). */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAIN_SET.has(domain);
}
