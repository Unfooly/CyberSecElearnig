import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

// Plan generowania audio: podsumowanie przed startem (ile narracji, znaków, szacowany czas nagrania), limit znaków na uruchomienie i pytanie
// o potwierdzenie. ElevenLabs rozlicza znaki, więc limit `--max-chars` (domyślnie 20 000) chroni przed przypadkowym spaleniem budżetu.

export const DEFAULT_MAX_CHARS = 20_000;
/** Szacunek tempa mowy po polsku (znaków na sekundę nagrania), tylko do informacji w podsumowaniu. */
const CHARS_PER_SECOND = 15;

export interface PlannedNarration {
  blockId: string;
  text: string;
  /** Nagranie już istnieje (HEAD/sidecar): nie będzie generowane ani rozliczane. */
  cached: boolean;
}

export interface PlanSummary {
  total: number;
  cached: number;
  /** Narracje do wygenerowania. */
  toGenerate: number;
  /** Znaki do wygenerowania (podstawa rozliczenia w ElevenLabs). */
  chars: number;
  /** Szacowany czas nagrań do wygenerowania (minuty, w górę do 0,1). */
  estimatedMinutes: number;
}

export function summarizePlan(items: PlannedNarration[]): PlanSummary {
  const fresh = items.filter((item) => !item.cached);
  const chars = fresh.reduce((sum, item) => sum + item.text.length, 0);
  return {
    total: items.length,
    cached: items.length - fresh.length,
    toGenerate: fresh.length,
    chars,
    estimatedMinutes: Math.ceil((chars / CHARS_PER_SECOND / 60) * 10) / 10,
  };
}

/** Zdanie do wypisania przed startem. */
export function formatPlan(summary: PlanSummary): string {
  return (
    `${summary.toGenerate} narracji do wygenerowania (${summary.cached} z ${summary.total} już istnieje), ` +
    `${summary.chars} znaków, ~${summary.estimatedMinutes.toFixed(1)} min nagrania (ElevenLabs rozlicza znaki).`
  );
}

/** Przekroczenie limitu znaków to błąd PRZED jakimkolwiek wywołaniem ElevenLabs. */
export function enforceMaxChars(summary: PlanSummary, maxChars: number): void {
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error('--max-chars musi być dodatnią liczbą całkowitą.');
  if (summary.chars > maxChars) {
    throw new Error(`Plan wymaga ${summary.chars} znaków, limit (--max-chars) to ${maxChars}. Zwiększ limit świadomie albo użyj --only, żeby wygenerować mniej.`);
  }
}

export interface ConfirmOptions {
  /** --yes: bez pytania. */
  yes?: boolean;
  input?: Readable;
  output?: Writable;
}

/**
 * Pytanie "kontynuować? [y/N]": tylko `y`/`yes`/`t`/`tak` (bez rozróżniania wielkości liter) potwierdza; wszystko inne, w tym pusta odpowiedź,
 * zamknięcie wejścia i brak terminala (np. skrypt bez TTY), to NIE. Brak nadmiaru odwagi: bez --yes nic nie jest generowane po cichu.
 */
export async function confirm(question: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (options.yes) return true;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const rl = createInterface({ input, output, terminal: false });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.once('close', () => resolve(''));
      output.write(`${question} [y/N] `);
      rl.once('line', (line) => resolve(line));
    });
    return /^(y|yes|t|tak)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
