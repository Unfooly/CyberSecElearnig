import { randomInt } from 'crypto';

/**
 * Planer rozłożenia wysyłki kampanii w oknie czasowym. CZYSTA funkcja z wstrzykiwanym generatorem liczb
 * losowych (testy bez czekania i bez losowości).
 *
 * Momenty są i.i.d. jednostajne w [from, to] (nie ma "fali" o równej godzinie). Wynik jest posortowany rosnąco,
 * więc wołający MUSI przetasować go (shuffled) przed przypisaniem odbiorcom - inaczej kolejność z bazy
 * przekładałaby się na kolejność wysyłki.
 */
export function planSendTimes(count: number, from: Date, to: Date, rng: () => number = Math.random): Date[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Liczba odbiorców musi być nieujemną liczbą całkowitą.');
  }
  const start = from.getTime();
  const end = to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('Nieprawidłowe okno czasowe.');
  }
  const span = end - start;
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const sample = rng();
    // rng() ∈ [0, 1); zabezpieczenie przed generatorem zwracającym wartość spoza zakresu.
    const clamped = Math.min(Math.max(sample, 0), 1);
    times.push(start + Math.floor(clamped * span));
  }
  return times.sort((a, b) => a - b).map((time) => new Date(time));
}

// Kryptograficzny generator [0, 1): kolejności wysyłki nie da się odgadnąć (pracownicy nie przewidzą, kto dostanie
// wiadomość jako następny).
const secureRandom = () => randomInt(2 ** 32) / 2 ** 32;

/**
 * Tasuje kopię tablicy (Fisher-Yates). planSendTimes zwraca czasy POSORTOWANE, więc przypisanie ich odbiorcom
 * według indeksu (kolejność z bazy = kolejność założenia kont) dawałoby korelację "kto starszy, ten wcześniej";
 * przed przypisaniem tasujemy czasy.
 */
export function shuffled<T>(items: readonly T[], rng: () => number = secureRandom): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(rng() * (index + 1)), index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
