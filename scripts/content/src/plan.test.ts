import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { confirm, DEFAULT_MAX_CHARS, enforceMaxChars, formatPlan, summarizePlan } from './plan.js';

const items = [
  { blockId: 'a', text: 'x'.repeat(900), cached: false },
  { blockId: 'b', text: 'y'.repeat(100), cached: true },
  { blockId: 'c', text: 'z'.repeat(1800), cached: false },
];

describe('summarizePlan', () => {
  it('liczy tylko narracje do wygenerowania (istniejące nie są rozliczane), szacuje minuty w górę do 0,1', () => {
    const summary = summarizePlan(items);
    expect(summary).toEqual({ total: 3, cached: 1, toGenerate: 2, chars: 2700, estimatedMinutes: 3 }); // 2700 / 15 s = 180 s = 3,0 min
  });

  it('pusty plan i same istniejące: zero znaków', () => {
    expect(summarizePlan([])).toEqual({ total: 0, cached: 0, toGenerate: 0, chars: 0, estimatedMinutes: 0 });
    expect(summarizePlan([{ blockId: 'a', text: 'abc', cached: true }]).chars).toBe(0);
  });

  it('formatPlan: X narracji, Y znaków, ~Z min', () => {
    expect(formatPlan(summarizePlan(items))).toBe('2 narracji do wygenerowania (1 z 3 już istnieje), 2700 znaków, ~3.0 min nagrania (ElevenLabs rozlicza znaki).');
  });
});

describe('enforceMaxChars', () => {
  it('domyślny limit to 20 000 znaków; przekroczenie to błąd z propozycją wyjścia', () => {
    expect(DEFAULT_MAX_CHARS).toBe(20_000);
    expect(() => enforceMaxChars(summarizePlan(items), 2700)).not.toThrow();
    expect(() => enforceMaxChars(summarizePlan(items), 2699)).toThrow(/2700 znaków, limit .* 2699.*--only/);
  });

  it.each([0, -5, 1.5, Number.NaN])('niepoprawny limit %s to błąd', (max) => {
    expect(() => enforceMaxChars(summarizePlan(items), max)).toThrow(/dodatnią liczbą/);
  });
});

describe('confirm', () => {
  async function ask(answer: string | null, options: { yes?: boolean } = {}) {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk) => chunks.push(String(chunk)));
    const promise = confirm('Kontynuować?', { ...options, input, output });
    if (answer !== null) input.write(`${answer}\n`);
    else input.end();
    return { result: await promise, printed: chunks.join('') };
  }

  it.each(['y', 'Y', 'yes', 'YES', 't', 'tak', 'Tak', '  y  '])('odpowiedź %j potwierdza', async (answer) => {
    expect((await ask(answer)).result).toBe(true);
  });

  it.each(['', 'n', 'no', 'nie', 'yy', 'ok', 'kontynuuj'])('odpowiedź %j NIE potwierdza (domyślnie nie)', async (answer) => {
    expect((await ask(answer)).result).toBe(false);
  });

  it('zamknięcie wejścia (brak terminala, EOF) to NIE; pytanie jest wypisane z [y/N]', async () => {
    const { result, printed } = await ask(null);
    expect(result).toBe(false);
    expect(printed).toContain('Kontynuować? [y/N]');
  });

  it('--yes pomija pytanie (nic nie jest wypisywane ani czytane)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk) => chunks.push(String(chunk)));
    expect(await confirm('Kontynuować?', { yes: true, input, output })).toBe(true);
    expect(chunks).toEqual([]);
  });
});
