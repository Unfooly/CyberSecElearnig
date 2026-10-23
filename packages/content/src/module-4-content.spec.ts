import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 4 „Na skróty” (shadow IT) - treść zgodna ze scenariuszem zatwierdzonym przez właściciela 2026-10-23
// (docs/modules/modul-4-na-skroty.md) i trybem prostym (D-132): kolejność bloków, trzy zasady raportu dosłownie, 6 sytuacji do oceny
// (4 „zapytaj IT”, 2 bezpieczne) z własnymi werdyktami (D-151), bez wątku kryminalnego, bez form rodzajowych w poleceniach, bez
// prawdziwych marek i domen, klucz odpowiedzi nie idzie do klienta.
const MODULE_4 = join(__dirname, '..', 'modules', 'na-skroty', 'module.json');
const SCENES = join(__dirname, '..', '..', '..', 'scripts', 'content', 'scenes', 'examples', 'na-skroty');
const raw = JSON.parse(readFileSync(MODULE_4, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };
type Hotspot = { id: string; x: number; y: number; width: number; height: number; required?: boolean; evidence?: boolean };

describe('moduł 4 „Na skróty” - treść', () => {
  it('waliduje się w trybie prostym, tylko po polsku, kategoria IT_HYGIENE, bez ostrzeżeń', () => {
    expect(parsed.simpleMode).toBe(true);
    expect(parsed.locales).toEqual(['pl']);
    expect(parsed.category).toBe('IT_HYGIENE');
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność bloków ze scenariusza: odprawa, biurko (4 narzędzia), skutki (4 karty), sytuacje, dwa wybory, raport', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'odprawa:BRIEFING',
      'biurko:SCENE_HOTSPOTS',
      'skutki:SCENE_HOTSPOTS',
      'bezpieczne-czy-it:SWIPE_SORT',
      'brak-programu:QUIZ',
      'juz-wklejone:QUIZ',
      'raport:SUMMARY',
    ]);
    const desk = block('biurko').hotspots as Hotspot[];
    expect(desk.map((h) => h.id)).toEqual(['czat', 'chmura', 'program', 'pendrive']);
    expect(desk.every((h) => h.required && h.evidence)).toBe(true);
    const effects = block('skutki').hotspots as (Hotspot & { content: string })[];
    expect(effects.map((h) => h.id)).toEqual(['dane', 'wirus', 'prawo', 'pliki']);
    // Karty skutków to też dowody (z notatką): „Zabierz” przy przedmiocie bez dowodu daje komunikat „To nie jest dowód”.
    expect(effects.every((h) => h.required && h.evidence)).toBe(true);
    for (const card of effects) expect(card.content.length).toBeLessThanOrEqual(140);
  });

  it('definicja shadow IT ze specyfikacji w narracji wejścia biurka', () => {
    expect((block('biurko').narration as { text: string }).text).toBe(
      'Shadow IT to każde narzędzie, którego używasz do pracy, a którego firma nie sprawdziła i nie zatwierdziła.',
    );
  });

  it('raport: trzy zasady dosłownie w tekście i w opisie grafiki zamknięcia, bez powtarzania ich w `lessons`', () => {
    const rules = [
      'Nowy program, strona albo AI do pracy? Najpierw zapytaj IT – pomogą znaleźć bezpieczne narzędzie.',
      'Dane firmy i klientów tylko w firmowych narzędziach – także w AI.',
      'Coś poszło nie tak? Zgłoś od razu. Liczy się czas, nie szukanie winnych.',
    ];
    expect(block('raport').lessons).toBeUndefined();
    const closing = block('raport').closing as Record<string, string>;
    for (const rule of rules) {
      expect(block('raport').text).toContain(rule);
      expect(closing.alt).toContain(rule);
    }
    expect(closing.noteAlt).toContain('Najpierw zapytaj IT.');
    expect(closing.stampAlt).toContain('SPRAWA ZAMKNIĘTA');
  });

  it('współrzędne hotspotów obu scen i slotów raportu = *.hotspots.json kompozytora (poziomo i pionowo)', () => {
    const rects = (name: string) =>
      Object.fromEntries((JSON.parse(readFileSync(join(SCENES, `${name}.hotspots.json`), 'utf8')) as { id: string; x: number; y: number; w: number; h: number }[]).map(({ id, ...r }) => [id, r]));
    const asRects = (list: Hotspot[]) => Object.fromEntries(list.map((h) => [h.id, { x: h.x, y: h.y, w: h.width, h: h.height }]));
    for (const [id, scene] of [['biurko', 'biurko-bartka'], ['skutki', 'tablica-skutki']]) {
      expect(asRects(block(id).hotspots as Hotspot[])).toEqual(rects(scene));
      expect(asRects(block(id).portraitHotspots as Hotspot[])).toEqual(rects(`${scene}-pion`));
    }
    const slotIds = { evidence: 'slot-dowody', time: 'slot-czas', xp: 'slot-xp', lessons: 'slot-wnioski', signature: 'podpis', stamp: 'slot-pieczec', note: 'slot-liscik' };
    const closing = block('raport').closing as { slots: Record<string, unknown>; portrait: { slots: Record<string, unknown> } };
    const byPart = (slots: Record<string, unknown>) => Object.fromEntries(Object.entries(slotIds).map(([slot, part]) => [part, slots[slot]]));
    expect(byPart(closing.slots)).toEqual(rects('zamkniecie-raport'));
    expect(byPart(closing.portrait.slots)).toEqual(rects('zamkniecie-raport-pion'));
  });

  it('sytuacje: 6 kart-sytuacji (4 „zapytaj IT”, 2 bezpieczne), werdykty „Zapytaj IT” / „Bezpieczne”, komentarz ≤ 140 znaków', () => {
    const swipe = block('bezpieczne-czy-it') as { labels: unknown; cards: { channel: string; correct: string; feedback: string }[] };
    expect(swipe.labels).toEqual({ suspicious: 'Zapytaj IT', ok: 'Bezpieczne' });
    expect(swipe.cards).toHaveLength(6);
    expect(swipe.cards.every((c) => c.channel === 'situation')).toBe(true);
    expect(swipe.cards.filter((c) => c.correct === 'suspicious')).toHaveLength(4);
    expect(swipe.cards.filter((c) => c.correct === 'ok')).toHaveLength(2);
    for (const card of swipe.cards) expect(card.feedback.length).toBeLessThanOrEqual(140);
  });

  it('wybory: jedna dobra odpowiedź (zgłoszenie do IT), podpowiedź po dwóch błędach; skasowanie historii nie usuwa danych', () => {
    const options = (id: string) => block(id).options as { text: string; correct: boolean; feedback: string }[];
    for (const id of ['brak-programu', 'juz-wklejone']) {
      expect(options(id).filter((o) => o.correct)).toHaveLength(1);
      expect(typeof block(id).hint).toBe('string');
    }
    expect(options('brak-programu').find((o) => o.correct)!.text).toBe('Zgłaszam potrzebę do IT i piszę, do czego jest mi potrzebny.');
    expect(options('juz-wklejone').find((o) => o.correct)!.text).toBe('Od razu zgłaszam to do IT.');
    expect(options('juz-wklejone').find((o) => /historię/.test(o.text))!.feedback).toBe('Skasowanie historii u siebie nie usuwa danych z serwerów narzędzia.');
  });

  it('polecenia i pytania bez form rodzajowych (-łeś/-łaś) - decyzja właściciela 2026-10-23', () => {
    const prompts = parsed.blocks.flatMap((b) => {
      const item = b as unknown as { tip?: string; prompt?: string; options?: { text: string }[]; cards?: { text: string }[] };
      return [item.tip, item.prompt, ...(item.options ?? []).map((o) => o.text), ...(item.cards ?? []).map((c) => c.text)].filter((t): t is string => !!t);
    });
    expect(prompts.length).toBeGreaterThan(10);
    // Czas przeszły 2. osoby (zrobiłeś/zrobiłaś); „-łam” bywa czasem teraźniejszym („wysyłam”) - odpowiedzi są w czasie teraźniejszym.
    for (const text of prompts) expect(text).not.toMatch(/\p{L}+(łeś|łaś)\b/u);
  });

  it('bez wątku kryminalnego i bez prawdziwych marek: brak oszustów, faktur i przestępców; adresy tylko .test / .example', () => {
    const sources = [JSON.stringify(raw), ...readdirSync(SCENES).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(SCENES, f), 'utf8'))].join('\n');
    expect(sources).not.toMatch(/oszu|przestęp|faktur|wyłudz|haker/i);
    const domains = [...sources.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(test|example|pl|com|net|org|eu|io|app|info|me|tv|ai))\b/gi)].map((m) => m[1]);
    for (const domain of domains) expect(domain).toMatch(/\.(test|example)$/);
  });

  it('klient nie dostaje klucza odpowiedzi ani komentarzy do kart', () => {
    const swipe = toClientBlock(block('bezpieczne-czy-it') as never, context);
    expect(JSON.stringify(swipe)).not.toMatch(/"correct"|"feedback"|"hint"/);
    for (const id of ['brak-programu', 'juz-wklejone']) {
      expect(JSON.stringify(toClientBlock(block(id) as never, context))).not.toMatch(/"correct"|"feedback"|"hint"/);
    }
  });
});
