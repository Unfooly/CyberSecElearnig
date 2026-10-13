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
      'odprawa:BRIEFING',
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

  it('odprawa: jedna statyczna scena (poziomo i pionowo) bez hotspotu - dalej przyciskiem', () => {
    const steps = block('odprawa').steps as Record<string, unknown>[];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'typewriter', cta: 'Odbierz telefon' });
    expect(steps[0].image).toMatch(/scenes\/pl\/odprawa\./);
    expect((steps[0].portrait as Record<string, unknown>).image).toMatch(/scenes\/pl\/odprawa-pion\./);
    expect(steps[0].hotspot).toBeUndefined();
    expect((steps[0].portrait as Record<string, unknown>).hotspot).toBeUndefined();
  });

  it('raport: trzy zasady dosłownie w tekście i w opisie grafiki zamknięcia (wpalone w grafikę), bez powtarzania ich w `lessons`', () => {
    const rules = [
      'Dziwna prośba od znajomego? Zadzwoń na znany numer.',
      'Kodu z SMS-a nie podajesz nikomu.',
      'Link w wiadomości? Nie klikaj – wejdź sam przez aplikację lub stronę.',
    ];
    expect(block('raport').lessons).toBeUndefined();
    const closing = block('raport').closing as Record<string, string>;
    for (const rule of rules) {
      expect(block('raport').text).toContain(rule);
      expect(closing.alt).toContain(rule);
    }
  });

  it('współrzędne hotspotów telefonu i slotów raportu = *.hotspots.json kompozytora (poziomo i pionowo)', () => {
    const scenes = join(__dirname, '..', '..', '..', 'scripts', 'content', 'scenes', 'examples', 'lancuszek');
    const rects = (name: string) =>
      Object.fromEntries((JSON.parse(readFileSync(join(scenes, `${name}.hotspots.json`), 'utf8')) as { id: string; x: number; y: number; w: number; h: number }[]).map(({ id, ...r }) => [id, r]));
    const asRect = (h: { x: number; y: number; width: number; height: number }) => ({ x: h.x, y: h.y, w: h.width, h: h.height });
    const phone = block('telefon') as { hotspots: { id: string; x: number; y: number; width: number; height: number }[]; portraitHotspots: { id: string; x: number; y: number; width: number; height: number }[] };
    expect(Object.fromEntries(phone.hotspots.map((h) => [h.id, asRect(h)]))).toEqual(rects('telefon-oli'));
    expect(Object.fromEntries(phone.portraitHotspots.map((h) => [h.id, asRect(h)]))).toEqual(rects('telefon-oli-pion'));
    // Sloty raportu: nazwy w treści (evidence...) vs części klocka w kompozytorze (slot-dowody...).
    const slotIds = { evidence: 'slot-dowody', time: 'slot-czas', xp: 'slot-xp', lessons: 'slot-wnioski', signature: 'podpis', stamp: 'slot-pieczec', note: 'slot-liscik' };
    const closing = block('raport').closing as { slots: Record<string, unknown>; portrait: { slots: Record<string, unknown> } };
    const byPart = (slots: Record<string, unknown>) => Object.fromEntries(Object.entries(slotIds).map(([slot, part]) => [part, slots[slot]]));
    expect(byPart(closing.slots)).toEqual(rects('zamkniecie-raport'));
    expect(byPart(closing.portrait.slots)).toEqual(rects('zamkniecie-raport-pion'));
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
