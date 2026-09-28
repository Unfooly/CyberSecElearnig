import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectNarrations, ttsInputOf } from './pipeline.js';

// Lektor (ElevenLabs) źle czyta godziny, kwoty i numery zapisane cyframi („8:47” w ostatniej scenie modułu 1, fix/tts-numbers,
// D-109). Reguła: to, co idzie do TTS (`spokenText`, a bez niego `text`) nie ma ŻADNEJ cyfry - liczby słownie, w przypadku zależnym od
// zdania. Test opiera się na źródle prawdy potoku (collectNarrations + ttsInputOf, NARRATION_PATHS), więc sprawdza dokładnie to, co
// nagrywamy - także nową ścieżkę dodaną do NARRATION_PATHS - a pomija podpowiedzi (hints: tylko tekst). Tę samą regułę egzekwuje
// walidacja modułu (packages/content, parseModule).

const modulesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'content', 'modules');
const modules = readdirSync(modulesDir).filter((slug) => existsSync(join(modulesDir, slug, 'module.json')));

/** Nagrania, których tekst dla TTS ma cyfry (miejsce + zdanie z cyfrą - do komunikatu). */
function spokenDigits(raw: Record<string, unknown>): string[] {
  return collectNarrations(raw)
    .map((ref) => ({ id: ref.id, spoken: ttsInputOf(ref) }))
    .filter(({ spoken }) => /\d/.test(spoken))
    .map(({ id, spoken }) => `${id}: „${spoken.match(/[^.!?]*\d[^.!?]*/)?.[0]?.trim()}”`);
}

describe('tekst czytany przez lektora bez cyfr (fix/tts-numbers, D-109)', () => {
  it('bierze to, co idzie do TTS: spokenText przed text, także answerNarration; pomija podpowiedzi (hints - bez nagrań)', () => {
    const found = spokenDigits({
      blocks: [
        { id: 'a', narration: { text: 'Wtorek, 9:40.', spokenText: 'Wtorek, dziewiąta czterdzieści.' } },
        { id: 'b', questions: [{ answerNarration: { text: 'O 9:05 zadzwonił.' } }] },
        { id: 'c', hints: [{ narration: { text: 'Spójrz na 8:58.' } }] },
      ],
    });
    expect(found).toEqual(['b#questions.0.answerNarration: „O 9:05 zadzwonił”']);
  });

  it.each(modules)('%s: żadne nagranie nie ma cyfr w tekście dla TTS (liczby słownie w spokenText)', (slug) => {
    const raw = JSON.parse(readFileSync(join(modulesDir, slug, 'module.json'), 'utf8'));
    expect(collectNarrations(raw).length).toBeGreaterThan(0);
    expect(spokenDigits(raw)).toEqual([]);
  });
});
