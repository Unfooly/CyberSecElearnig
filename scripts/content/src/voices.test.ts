import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentIndex } from './io.js';
import { isPlaceholderVoiceId, loadVoices, parseVoiceConfig, parseVoices, voiceRoleOf, voicesForLocale } from './voices.js';

const VOICES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'voices.json');
// Stary kształt (rola -> voiceId) dla ról v5 + nowe role modułu 2 (D-114) w kształcie per język i sameAs.
const valid = {
  narrator: 'voice-narrator',
  komisarz: 'voice-komisarz01',
  bank: 'voice-bank001',
  marek: 'voice-marek01',
  karol: { pl: 'voice-karol-pl' },
  pawel: { pl: 'voice-pawel-pl', en: 'voice-pawel-en' },
  oszust: { sameAs: 'pawel' },
};

describe('voices.json (rola głosu -> voiceId, D-082; per język i sameAs, D-114)', () => {
  it('role w voices.json to dokładnie role ze schematu treści (VOICE_ROLES)', () => {
    expect(Object.keys(parseVoices(valid)).sort()).toEqual([...contentIndex.VOICE_ROLES].sort());
  });

  it('stary kształt "rola": "voiceId" znaczy { pl: voiceId } - ten sam wynik', () => {
    const newShape = { ...valid, narrator: { pl: 'voice-narrator' }, komisarz: { pl: 'voice-komisarz01' } };
    expect(parseVoices(newShape)).toEqual(parseVoices(valid));
    expect(parseVoices(valid).narrator).toBe('voice-narrator');
  });

  it('oszust = głos Pawła w KAŻDYM języku (sameAs), brak głosu w języku = głos pl', () => {
    const config = parseVoiceConfig(valid);
    expect(voicesForLocale(config, 'pl').oszust).toBe('voice-pawel-pl');
    expect(voicesForLocale(config, 'en').oszust).toBe('voice-pawel-en');
    expect(voicesForLocale(config, 'en').karol).toBe('voice-karol-pl');
    for (const locale of ['pl', 'en']) expect(voicesForLocale(config, locale).oszust).toBe(voicesForLocale(config, locale).pawel);
  });

  it('commitowany voices.json: oszust i pawel mają zawsze ten sam voiceId (świadoma decyzja, nie literówka)', () => {
    for (const locale of contentIndex.CONTENT_LOCALES) {
      const voices = loadVoices(VOICES_PATH, undefined, locale);
      expect(voices.oszust).toBe(voices.pawel);
    }
  });

  it('sameAs: nieznana rola, łańcuch, odwołanie do siebie i dodatkowe pola to błąd', () => {
    expect(() => parseVoices({ ...valid, oszust: { sameAs: 'nikt' } })).toThrow(/sameAs wskazuje nieznaną rolę "nikt"/);
    expect(() => parseVoices({ ...valid, karol: { sameAs: 'oszust' } })).toThrow(/bez łańcuchów/);
    expect(() => parseVoices({ ...valid, oszust: { sameAs: 'oszust' } })).toThrow(/bez łańcuchów/);
    expect(() => parseVoices({ ...valid, oszust: { sameAs: 'pawel', pl: 'voice-x-12345' } })).toThrow(/nie łączy się z innymi polami/);
  });

  it('wpis per język: wymagany pl, tylko znane języki, voiceId jako tekst', () => {
    expect(() => parseVoices({ ...valid, karol: { en: 'voice-karol-en' } })).toThrow(/"karol" musi mieć voiceId dla "pl"/);
    expect(() => parseVoices({ ...valid, karol: { pl: 'voice-karol-pl', de: 'voice-karol-de' } })).toThrow(/nieznane języki de/);
    expect(() => parseVoices({ ...valid, karol: { pl: 42 } })).toThrow(/"karol" musi mieć voiceId dla "pl"/);
    expect(() => parseVoices({ ...valid, karol: { pl: 'voice-karol-pl', en: 42 } })).toThrow(/język "en": voiceId jako tekst/);
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

  it('commitowany scripts/content/voices.json jest poprawny i bez placeholderów; brak pliku i zły JSON to czytelny błąd', () => {
    const voices = loadVoices(VOICES_PATH);
    expect(Object.keys(voices).sort()).toEqual([...contentIndex.VOICE_ROLES].sort());
    for (const id of Object.values(voices)) expect(isPlaceholderVoiceId(id)).toBe(false);
    expect(() => loadVoices('/nie/ma/voices.json')).toThrow(/Brak pliku/);
    expect(() => loadVoices('x', () => '{zly')).toThrow(/niepoprawny JSON/);
  });
});
