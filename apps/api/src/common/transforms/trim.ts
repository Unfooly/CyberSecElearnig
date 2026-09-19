import { Transform } from 'class-transformer';

// Przycina spacje z brzegów pól tekstowych z formularzy (nazwa firmy, adres...).
// Wartości nie-tekstowe zostają bez zmian, żeby walidator zgłosił właściwy błąd typu.
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
