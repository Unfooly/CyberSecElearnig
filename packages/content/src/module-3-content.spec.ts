import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 3 „Komunikatory i SMS-y” (slug `lancuszek`) - treść według nagrania właściciela „Usługi przesyłania wiadomości” (2026-11-22,
// D-203; scenariusz: docs/modules/modul-3-komunikatory-nagranie.md), w trybie prostym (D-132): kolejność ekranów z nagrania, ilustracja
// obok tekstu i pytania (D-200), postacie zatwierdzone przez właściciela (Ola, fałszywa „Marta”, Adam z IT), bez wątku BLIK i kodu z SMS-a
// (decyzja właściciela), rozmowa i SMS z czterema celami (kompozytor), trzy zasady dosłownie, bez form rodzajowych, bez prawdziwych marek
// i domen, klucz odpowiedzi nie idzie do klienta.
const MODULE_3 = join(__dirname, '..', 'modules', 'lancuszek', 'module.json');
const SCENES = join(__dirname, '..', '..', '..', 'scripts', 'content', 'scenes', 'examples', 'lancuszek');
const raw = JSON.parse(readFileSync(MODULE_3, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };
type Hotspot = { id: string; x: number; y: number; width: number; height: number; required?: boolean; evidence?: boolean; content?: string };
type Option = { text: string; correct: boolean; feedback: string };
const QUIZZES = ['prawda', 'niebezpieczne', 'film', 'smishing'];
const RULES = [
  'Plik albo aplikacja od nieznajomego? Nie otwieraj – zapytaj IT.',
  'Dziwna wiadomość od znajomego? Sprawdź ją innym kanałem.',
  'SMS z linkiem i pośpiechem? Nie klikaj i nie odpisuj.',
];

describe('moduł 3 „Komunikatory i SMS-y” - treść', () => {
  it('waliduje się w trybie prostym, tylko po polsku, bez ostrzeżeń; slug i numer sprawy bez zmian', () => {
    expect(parsed.simpleMode).toBe(true);
    expect(parsed.locales).toEqual(['pl']);
    expect(parsed.slug).toBe('lancuszek');
    expect(parsed.caseNumber).toBe(3);
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność ekranów z nagrania: zaproszenie, komunikator, wirus, rozmowa, SMS, łańcuszek, trzy pytania, quiz (4 pytania), raport', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'zaproszenie:NARRATIVE',
      'nowy-komunikator:NARRATIVE',
      'wirus:NARRATIVE',
      'rozmowa:SCENE_HOTSPOTS',
      'sms:SCENE_HOTSPOTS',
      'lancuszek:NARRATIVE',
      'trzy-pytania:NARRATIVE',
      'czas-na-quiz:NARRATIVE',
      'prawda:QUIZ',
      'niebezpieczne:QUIZ',
      'film:QUIZ',
      'smishing:QUIZ',
      'raport:SUMMARY',
    ]);
    const ids = (id: string) => (block(id).hotspots as Hotspot[]).map((h) => h.id);
    expect(ids('rozmowa')).toEqual(['profil', 'pytania', 'odpowiedz', 'plik']);
    expect(ids('sms')).toEqual(['nadawca', 'presja', 'link', 'stop']);
    for (const id of ['rozmowa', 'sms']) {
      const hotspots = block(id).hotspots as Hotspot[];
      expect(hotspots.every((h) => h.required && h.evidence)).toBe(true);
      // Karty celów - walidator trybu prostego ich nie limituje, a mają się zmieścić na telefonie.
      for (const card of hotspots) expect({ id: card.id, short: (card.content ?? '').length <= 150 }).toEqual({ id: card.id, short: true });
    }
  });

  it('bez wątku BLIK, kodu z SMS-a i skrzynki do przesuwania (decyzja właściciela 2026-11-22)', () => {
    expect(parsed.blocks.map((b) => b.type)).not.toContain('SWIPE_SORT');
    expect(JSON.stringify(raw)).not.toMatch(/BLIK|kod z SMS/i);
  });

  it('każdy ekran z tekstem i każde pytanie ma ilustrację (opublikowany WebP) z opisem', () => {
    const illustrated = parsed.blocks.filter((b) => b.type === 'NARRATIVE' || b.type === 'QUIZ');
    expect(illustrated).toHaveLength(10);
    for (const item of illustrated) {
      const illustration = (item as unknown as { illustration?: { image: string; alt: string } }).illustration;
      expect({ id: item.id, image: illustration?.image }).toEqual({ id: item.id, image: expect.stringMatching(/^assets\/lancuszek\/images\/[a-z-]+\.[0-9a-f]{8}\.webp$/) });
      expect({ id: item.id, altLong: (illustration?.alt.trim().length ?? 0) > 20 }).toEqual({ id: item.id, altLong: true });
    }
  });

  it('postacie: Ola, fałszywa „Marta”, Adam z IT', () => {
    expect(block('zaproszenie').text).toContain('Ola Malec');
    expect(block('zaproszenie').text).toContain('Marta');
    expect(block('trzy-pytania').text).toContain('Adam z działu IT');
  });

  it('pytania: wielokrotny wybór w trzech (co najmniej jedna zła), smishing - jedna dobra; podpowiedź po dwóch błędach', () => {
    const options = (id: string) => block(id).options as Option[];
    for (const id of QUIZZES) expect(typeof block(id).hint).toBe('string');
    for (const id of ['prawda', 'niebezpieczne', 'film']) {
      expect(block(id).multiple).toBe(true);
      expect(options(id).some((o) => !o.correct)).toBe(true);
    }
    expect(options('prawda').filter((o) => o.correct).map((o) => o.text)).toEqual(['Dostawca komunikatora może zbierać dane o mnie, np. do reklam.']);
    expect(options('film').filter((o) => o.correct)).toHaveLength(2);
    expect(block('smishing').multiple).toBeUndefined();
    expect(options('smishing').find((o) => o.correct)!.text).toMatch(/^Oszustwem przez SMS-a/);
  });

  it('raport: trzy zasady dosłownie w tekście i w opisie grafiki zamknięcia (wpalone w grafikę), bez `lessons`', () => {
    expect(block('raport').lessons).toBeUndefined();
    expect(block('raport').narration).toBeUndefined();
    const closing = block('raport').closing as Record<string, string>;
    for (const rule of RULES) {
      expect(block('raport').text).toContain(rule);
      expect(closing.alt).toContain(rule);
    }
    // Te same zasady w scenie, z której zbudowano grafikę zamknięcia (poziomo i pionowo).
    for (const name of ['zamkniecie-raport', 'zamkniecie-raport-pion']) {
      const strings = JSON.parse(readFileSync(join(SCENES, `${name}.json`), 'utf8')).strings.pl as { zasady: string[]; tytul: string };
      expect(strings.zasady).toEqual(RULES.map((rule, i) => `${i + 1}. ${rule}`));
      expect(strings.tytul).toBe('Komunikatory');
    }
  });

  it('współrzędne celów rozmowy i SMS-a oraz slotów raportu = *.hotspots.json kompozytora (poziomo i pionowo)', () => {
    const rects = (name: string) =>
      Object.fromEntries((JSON.parse(readFileSync(join(SCENES, `${name}.hotspots.json`), 'utf8')) as { id: string; x: number; y: number; w: number; h: number }[]).map(({ id, ...r }) => [id, r]));
    const asRects = (list: Hotspot[]) => Object.fromEntries(list.map((h) => [h.id, { x: h.x, y: h.y, w: h.width, h: h.height }]));
    for (const [id, scene] of [['rozmowa', 'komunikator'], ['sms', 'sms']]) {
      expect(asRects(block(id).hotspots as Hotspot[])).toEqual(rects(scene));
      expect(asRects(block(id).portraitHotspots as Hotspot[])).toEqual(rects(`${scene}-pion`));
    }
    const slotIds = { evidence: 'slot-dowody', time: 'slot-czas', xp: 'slot-xp', lessons: 'slot-wnioski', signature: 'podpis', stamp: 'slot-pieczec', note: 'slot-liscik' };
    const closing = block('raport').closing as { slots: Record<string, unknown>; portrait: { slots: Record<string, unknown> } };
    const byPart = (slots: Record<string, unknown>) => Object.fromEntries(Object.entries(slotIds).map(([slot, part]) => [part, slots[slot]]));
    expect(byPart(closing.slots)).toEqual(rects('zamkniecie-raport'));
    expect(byPart(closing.portrait.slots)).toEqual(rects('zamkniecie-raport-pion'));
  });

  it('polecenia i pytania bez form rodzajowych (-łeś/-łaś) - decyzja właściciela 2026-10-23', () => {
    const prompts = parsed.blocks.flatMap((b) => {
      const item = b as unknown as { tip?: string; prompt?: string; text?: string; options?: { text: string }[] };
      const narrative = b.type === 'NARRATIVE' ? item.text : undefined;
      return [item.tip, item.prompt, narrative, ...(item.options ?? []).map((o) => o.text)].filter((t): t is string => !!t);
    });
    expect(prompts.length).toBeGreaterThan(10);
    for (const text of prompts) expect(text).not.toMatch(/\p{L}+(łeś|łaś)\b/u);
  });

  it('bez prawdziwych marek i działających domen: każdy adres (także w tekście wpalonym w grafiki) tylko w domenie .test / .example', () => {
    const sources = [JSON.stringify(raw), ...readdirSync(SCENES).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(SCENES, f), 'utf8'))].join('\n');
    expect(sources).not.toMatch(/Apple|Facebook|Messenger|WhatsApp|YouTube|Signal|Telegram/);
    const domains = [...sources.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(test|example|pl|com|net|org|eu|io|app|info|me|tv))\b/gi)].map((m) => m[1]);
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) expect(domain).toMatch(/\.(test|example)$/);
  });

  it('klient nie dostaje klucza odpowiedzi, komentarzy ani podpowiedzi; ilustracja tak', () => {
    for (const id of QUIZZES) {
      const client = toClientBlock(block(id) as never, context) as Record<string, unknown>;
      expect(JSON.stringify(client)).not.toMatch(/"correct"|"feedback"|"hint"/);
      expect(client.illustration).toEqual(block(id).illustration);
    }
  });
});
