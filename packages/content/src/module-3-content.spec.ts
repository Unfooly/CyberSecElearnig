import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 3 „Łańcuszek” (3b, D-140) - treść zgodna ze specyfikacją właściciela (2026-10-07) i trybem prostym (D-132): kolejność bloków,
// trzy zasady raportu dosłownie, 6 wiadomości do oceny (4 podejrzane, 2 w porządku), bez prawdziwych marek i działających domen
// (adresy tylko .test/.example), opis każdej grafiki, klucz odpowiedzi nie idzie do klienta.
const MODULE_3 = join(__dirname, '..', 'modules', 'lancuszek', 'module.json');
const raw = JSON.parse(readFileSync(MODULE_3, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };

describe('moduł 3 „Łańcuszek” - treść (3b)', () => {
  it('waliduje się w trybie prostym, tylko po polsku, bez ostrzeżeń', () => {
    expect(parsed.simpleMode).toBe(true);
    expect(parsed.locales).toEqual(['pl']);
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność bloków ze specyfikacji: odprawa, telefon (3 cele), wybór, skrzynka, BLIK, kod SMS, raport', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'odprawa:NARRATIVE',
      'telefon:SCENE_HOTSPOTS',
      'zaloguj:QUIZ',
      'wiadomosci:SWIPE_SORT',
      'blik:QUIZ',
      'kod-sms:QUIZ',
      'raport:SUMMARY',
    ]);
    const hotspots = block('telefon').hotspots as { id: string; required?: boolean }[];
    expect(hotspots.map((h) => h.id)).toEqual(['wiadomosc', 'link', 'logowanie']);
    expect(hotspots.every((h) => h.required)).toBe(true);
  });

  it('raport: trzy zasady dosłownie (także jako lista w tekście raportu)', () => {
    const rules = [
      'Dziwna prośba od znajomego? Zadzwoń na znany numer.',
      'Kodu z SMS-a nie podajesz nikomu.',
      'Link w wiadomości? Nie klikaj – wejdź sam przez aplikację lub stronę.',
    ];
    expect(block('raport').lessons).toEqual(rules);
    for (const rule of rules) expect(block('raport').text).toContain(rule);
  });

  it('skrzynka: 6 wiadomości, 4 podejrzane i 2 w porządku, każda z jednozdaniowym komentarzem', () => {
    const cards = block('wiadomosci').cards as { correct: string; feedback: string }[];
    expect(cards).toHaveLength(6);
    expect(cards.filter((c) => c.correct === 'suspicious')).toHaveLength(4);
    expect(cards.filter((c) => c.correct === 'ok')).toHaveLength(2);
    for (const card of cards) expect(card.feedback.length).toBeLessThanOrEqual(140);
  });

  it('wybory: jedna dobra odpowiedź (inny kanał, telefon na znany numer, kodu nie podajesz); podpowiedź po dwóch błędach', () => {
    const right = (id: string) => (block(id).options as { text: string; correct: boolean }[]).find((o) => o.correct)!.text;
    for (const id of ['zaloguj', 'blik', 'kod-sms']) {
      expect((block(id).options as { correct: boolean }[]).filter((o) => o.correct)).toHaveLength(1);
      expect(typeof block(id).hint).toBe('string');
    }
    expect(right('zaloguj')).toMatch(/innym kanałem/);
    expect(right('blik')).toMatch(/numer, który znam/);
    expect(right('kod-sms')).toMatch(/Nie podaję kodu/);
  });

  it('bez prawdziwych marek i działających domen: każdy adres (także w tekście wpalonym w grafiki) tylko w domenie .test / .example', () => {
    const scenes = join(__dirname, '..', '..', '..', 'scripts', 'content', 'scenes', 'examples', 'lancuszek');
    const sources = [JSON.stringify(raw), ...readdirSync(scenes).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(scenes, f), 'utf8'))].join('\n');
    // Domena = człon z kropką i znanym przyrostkiem domeny (także bez ścieżki); pomijamy nazwy plików (faktura.zip, *.svg, *.mp3, *.json).
    const domains = [...sources.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(test|example|pl|com|net|org|eu|io|app|info|me|tv))\b/gi)].map((m) => m[1]);
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) expect(domain).toMatch(/\.(test|example)$/);
  });

  it('klient nie dostaje klucza odpowiedzi ani komentarzy do kart', () => {
    const swipe = toClientBlock(block('wiadomosci') as never, context);
    expect(JSON.stringify(swipe)).not.toMatch(/"correct"|"feedback"|"hint"/);
    const quiz = toClientBlock(block('zaloguj') as never, context);
    expect(JSON.stringify(quiz)).not.toMatch(/"correct"|"feedback"|"hint"/);
  });
});
