import { Transform } from 'class-transformer';

// Adresy e-mail są porównywane wielkość-liter-wrażliwie (users.email @unique),
// więc A@x.pl i a@x.pl byłyby dwoma kontami - normalizujemy wszędzie tam,
// gdzie e-mail wchodzi do systemu (rejestracja, logowanie, reset, zaproszenie).
export const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
