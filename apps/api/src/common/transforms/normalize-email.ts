import { Transform } from 'class-transformer';
import { domainToASCII } from 'url';

// Adresy e-mail są porównywane wielkość-liter-wrażliwie (users.email @unique),
// więc A@x.pl i a@x.pl byłyby dwoma kontami - normalizujemy wszędzie tam,
// gdzie e-mail wchodzi do systemu (rejestracja, logowanie, reset, zaproszenie).
// Część domenowa idzie w punycode (bücher.de i xn--bcher-kva.de to ta sama
// skrzynka - inaczej dwa konta na jeden adres i obejście limitów).
export function normalizeEmailValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 0) {
    return trimmed;
  }
  // domainToASCII zwraca '' dla niepoprawnej domeny - wtedy zostawiamy wejście
  // bez zmian, a walidator (@IsEmail) je odrzuci.
  const domain = domainToASCII(trimmed.slice(at + 1));
  return domain ? `${trimmed.slice(0, at)}@${domain}` : trimmed;
}

export const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? normalizeEmailValue(value) : value));
