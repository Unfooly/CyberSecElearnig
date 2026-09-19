import { randomBytes } from 'crypto';
import { domainToASCII } from 'url';

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
// Etykieta DNS: litery/cyfry/myślnik, bez myślnika na początku i końcu.
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalizuje domenę do postaci przechowywanej i sprawdzanej w DNS: małe
 * litery, punycode (IDN), bez końcowej kropki. Zwraca null, gdy to nie jest
 * poprawna nazwa domeny (albo adres IP, albo host bez kropki).
 */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().replace(/\.$/, '').toLowerCase();
  if (!trimmed) {
    return null;
  }
  // domainToASCII zwraca '' dla niepoprawnych wejść (np. spacje, znaki zakazane).
  const ascii = domainToASCII(trimmed);
  if (!ascii || ascii.length > MAX_DOMAIN_LENGTH) {
    return null;
  }
  const labels = ascii.split('.');
  // Wymagamy co najmniej dwóch etykiet (firma.pl); "localhost" i liczby (IPv4) odpadają.
  if (labels.length < 2) {
    return null;
  }
  if (!labels.every((label) => label.length <= MAX_LABEL_LENGTH && LABEL_PATTERN.test(label))) {
    return null;
  }
  // Same cyfry w ostatniej etykiecie = adres IPv4, nie domena.
  if (/^\d+$/.test(labels[labels.length - 1])) {
    return null;
  }
  return ascii;
}

/** Znormalizowana domena z adresu e-mail (część po ostatnim @) albo null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  return normalizeDomain(email.slice(at + 1));
}

/**
 * Token do rekordu DNS TXT. NIE jest sekretem (trafia do publicznego DNS), ale
 * musi być nieodgadywalny, więc zawsze z crypto.randomBytes (nigdy Math.random).
 * 32 bajty = 64 znaki hex.
 */
export function generateDomainVerificationToken(): string {
  return randomBytes(32).toString('hex');
}
