// Polski NIP: 10 cyfr, ostatnia to suma kontrolna (wagi 6,5,7,2,3,4,5,6,7,
// modulo 11; reszta 10 = NIP nieprawidłowy). Wspólne dla API (walidacja) i
// frontendu (szybki feedback w formularzu), żeby reguły nie mogły się rozjechać.

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/**
 * Sprowadza wpis użytkownika do 10 cyfr: usuwa spacje i myślniki oraz
 * opcjonalny prefiks "PL". Zwraca null, gdy po oczyszczeniu nie ma dokładnie
 * 10 cyfr.
 */
export function normalizeNip(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, '').replace(/^PL/i, '');
  return /^\d{10}$/.test(cleaned) ? cleaned : null;
}

/** true tylko dla NIP-u o poprawnym formacie i sumie kontrolnej. */
export function isValidNip(input: string): boolean {
  const nip = normalizeNip(input);
  if (!nip) {
    return false;
  }
  // 0000000000 przechodzi sumę kontrolną (0 mod 11 = 0), ale nie jest NIP-em.
  if (/^(\d)\1{9}$/.test(nip)) {
    return false;
  }
  const digits = nip.split('').map(Number);
  const sum = NIP_WEIGHTS.reduce((acc, weight, index) => acc + weight * digits[index], 0);
  const control = sum % 11;
  return control !== 10 && control === digits[9];
}
