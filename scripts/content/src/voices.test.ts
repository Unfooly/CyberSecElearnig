import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentIndex } from './io.js';
import { isPlaceholderVoiceId, loadVoices, parseVoices, voiceRoleOf } from './voices.js';

const VOICES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'voices.json');
const valid = { narrator: 'voice-narrator', komisarz: 'voice-komisarz01', bank: 'voice-bank001', marek: 'voice-marek01' };

describe('voices.json (rola głosu -> voiceId, D-082)', () => {
  it('role w voices.json to dokładnie role ze schematu treści (VOICE_ROLES)', () => {
    expect(Object.keys(parseVoices(valid)).sort()).toEqual([...contentIndex.VOICE_ROLES].sort());
  });

  it('nieznana rola i brakująca rola to błąd (bez cichego fallbacku na narratora)', () => {
    expect(() => parseVoices({ ...valid, lektor2: 'voice-xxxxxx' })).toThrow(/nieznane role lektor2/);
    const { marek: _marek, ...missing } = valid;
    expect(() => parseVoices(missing)).toThrow(/brak ról marek/);
    expect(() => parseVoices({ ...valid, bank: 42 })).toThrow(/"bank" musi mieć voiceId jako tekst/);
    expect(() => parseVoices([])).toThrow(/oczekiwano obiektu/);
  });

  it('placeholder rozpoznawany po kształcie (nie ID ElevenLabs)', () => {
    for (const placeholder of ['<WKLEJ-ID-KOMISARZ>', '<obecny voiceId>', 'TODO', '', 'abc', 'WKLEJ_ID_KOMISARZ', 'PLACEHOLDER', 'wklej-id-komisarz', 'xxxxxxxxxx']) {
      expect(isPlaceholderVoiceId(placeholder)).toBe(true);
    }
    for (const id of ['o2xdfKUpc1Bwq7RchZuW', 'voice-narrator']) expect(isPlaceholderVoiceId(id)).toBe(false);
  });

  it('brak pola voice = narrator', () => {
    expect(voiceRoleOf({ text: 'x' })).toBe('narrator');
    expect(voiceRoleOf({ text: 'x', voice: 'bank' })).toBe('bank');
  });

  it('commitowany scripts/content/voices.json jest poprawny; brak pliku i zły JSON to czytelny błąd', () => {
    expect(Object.keys(loadVoices(VOICES_PATH)).sort()).toEqual([...contentIndex.VOICE_ROLES].sort());
    expect(() => loadVoices('/nie/ma/voices.json')).toThrow(/Brak pliku/);
    expect(() => loadVoices('x', () => '{zly')).toThrow(/niepoprawny JSON/);
  });
});
