import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 4 „Na skróty” (shadow IT) - treść według nagrania właściciela `shadowit.mp4` (2026-11-22, D-201; scenariusz:
// docs/modules/modul-4-na-skroty-nagranie.md), w trybie prostym (D-132): kolejność ekranów z nagrania, ilustracja obok tekstu i pytania
// (D-200), postacie zatwierdzone przez właściciela (Bartek, Adam z IT, Tomek, Kasia), tablica skutków i raport z poprzedniej wersji (trzy
// zasady dosłownie), bez wątku kryminalnego, bez form rodzajowych w poleceniach, bez prawdziwych marek i domen, klucz odpowiedzi nie idzie
// do klienta.
const MODULE_4 = join(__dirname, '..', 'modules', 'na-skroty', 'module.json');
const SCENES = join(__dirname, '..', '..', '..', 'scripts', 'content', 'scenes', 'examples', 'na-skroty');
const raw = JSON.parse(readFileSync(MODULE_4, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };
type Hotspot = { id: string; x: number; y: number; width: number; height: number; required?: boolean; evidence?: boolean };
type Option = { text: string; correct: boolean; feedback: string };
const QUIZZES = ['instalowac', 'bez-sprawdzenia', 'poczta-na-telefonie', 'pliki-w-chmurze'];

describe('moduł 4 „Na skróty” - treść', () => {
  it('waliduje się w trybie prostym, tylko po polsku, kategoria IT_HYGIENE, bez ostrzeżeń', () => {
    expect(parsed.simpleMode).toBe(true);
    expect(parsed.locales).toEqual(['pl']);
    expect(parsed.category).toBe('IT_HYGIENE');
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność ekranów z nagrania: sytuacja, pytanie, definicja, skutki, pracownik, dwie drogi, sprzęt, finał, quiz (3 pytania), raport', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'tabela:NARRATIVE',
      'instalowac:QUIZ',
      'shadow-it:NARRATIVE',
      'skutki:SCENE_HOTSPOTS',
      'pracownik:NARRATIVE',
      'dwie-drogi:NARRATIVE',
      'prywatny-telefon:NARRATIVE',
      'cala-naprzod:NARRATIVE',
      'czas-na-quiz:NARRATIVE',
      'bez-sprawdzenia:QUIZ',
      'poczta-na-telefonie:QUIZ',
      'pliki-w-chmurze:QUIZ',
      'raport:SUMMARY',
    ]);
    const effects = block('skutki').hotspots as (Hotspot & { content: string })[];
    expect(effects.map((h) => h.id)).toEqual(['dane', 'wirus', 'prawo', 'pliki']);
    expect(effects.every((h) => h.required && h.evidence)).toBe(true);
    // Karty skutków - walidator trybu prostego ich nie limituje, a mają się zmieścić na telefonie.
    for (const card of effects) expect(card.content.length).toBeLessThanOrEqual(140);
  });

  it('każdy ekran z tekstem i każde pytanie ma ilustrację (opublikowany WebP) z opisem', () => {
    const illustrated = parsed.blocks.filter((b) => b.type === 'NARRATIVE' || b.type === 'QUIZ');
    expect(illustrated).toHaveLength(11);
    for (const item of illustrated) {
      const illustration = (item as unknown as { illustration?: { image: string; alt: string } }).illustration;
      expect({ id: item.id, image: illustration?.image }).toEqual({ id: item.id, image: expect.stringMatching(/^assets\/na-skroty\/images\/[a-z-]+\.[0-9a-f]{8}\.webp$/) });
      expect({ id: item.id, altLong: (illustration?.alt.trim().length ?? 0) > 20 }).toEqual({ id: item.id, altLong: true });
    }
  });

  it('definicja shadow IT (zatwierdzona 2026-10-19) i postacie: Bartek, Adam z IT, Tomek, Kasia', () => {
    expect(block('shadow-it').text).toContain('Shadow IT to każde narzędzie, którego używasz do pracy, a którego firma nie sprawdziła i nie zatwierdziła');
    expect(block('dwie-drogi').text).toContain('Adama z działu IT');
    expect(block('bez-sprawdzenia').prompt).toContain('Tomek');
    expect(block('poczta-na-telefonie').prompt).toContain('Kasia');
    expect(block('pliki-w-chmurze').prompt).toContain('Kasia');
  });

  it('pytania: dobra odpowiedź to zawsze „zapytaj IT”/ryzyko; wielokrotny wybór - 3 dobre i 1 zła; podpowiedź po dwóch błędach', () => {
    const options = (id: string) => block(id).options as Option[];
    for (const id of QUIZZES) expect(typeof block(id).hint).toBe('string');
    expect(options('instalowac').find((o) => o.correct)!.text).toBe('Najpierw zapytać dział IT, czy może z niego korzystać.');
    expect(block('bez-sprawdzenia').multiple).toBe(true);
    expect(options('bez-sprawdzenia').filter((o) => o.correct)).toHaveLength(3);
    expect(options('bez-sprawdzenia').filter((o) => !o.correct).map((o) => o.text)).toEqual(['Nic się nie stanie, skoro program działa.']);
    expect(options('pliki-w-chmurze').find((o) => o.correct)!.text).toBe('Najpierw zapytać IT o zgodę i firmowe rozwiązanie.');
  });

  it('raport: trzy zasady dosłownie w tekście i w opisie grafiki zamknięcia, nowa historia (Bartek zapytał IT), bez `lessons`', () => {
    const rules = [
      'Nowy program, strona albo AI do pracy? Najpierw zapytaj IT – pomogą znaleźć bezpieczne narzędzie.',
      'Dane firmy i klientów tylko w firmowych narzędziach – także w AI.',
      'Coś poszło nie tak? Zgłoś od razu. Liczy się czas, nie szukanie winnych.',
    ];
    expect(block('raport').lessons).toBeUndefined();
    expect(block('raport').text).toContain('Zamiast instalować program z internetu, Bartek zapytał dział IT.');
    expect(block('raport').text).not.toMatch(/PDF|czatu/);
    const closing = block('raport').closing as Record<string, string>;
    for (const rule of rules) {
      expect(block('raport').text).toContain(rule);
      expect(closing.alt).toContain(rule);
    }
    expect(closing.noteAlt).toContain('Najpierw zapytaj IT.');
    expect(closing.stampAlt).toContain('SPRAWA ZAMKNIĘTA');
  });

  it('współrzędne hotspotów tablicy skutków i slotów raportu = *.hotspots.json kompozytora (poziomo i pionowo)', () => {
    const rects = (name: string) =>
      Object.fromEntries((JSON.parse(readFileSync(join(SCENES, `${name}.hotspots.json`), 'utf8')) as { id: string; x: number; y: number; w: number; h: number }[]).map(({ id, ...r }) => [id, r]));
    const asRects = (list: Hotspot[]) => Object.fromEntries(list.map((h) => [h.id, { x: h.x, y: h.y, w: h.width, h: h.height }]));
    expect(asRects(block('skutki').hotspots as Hotspot[])).toEqual(rects('tablica-skutki'));
    expect(asRects(block('skutki').portraitHotspots as Hotspot[])).toEqual(rects('tablica-skutki-pion'));
    const slotIds = { evidence: 'slot-dowody', time: 'slot-czas', xp: 'slot-xp', lessons: 'slot-wnioski', signature: 'podpis', stamp: 'slot-pieczec', note: 'slot-liscik' };
    const closing = block('raport').closing as { slots: Record<string, unknown>; portrait: { slots: Record<string, unknown> } };
    const byPart = (slots: Record<string, unknown>) => Object.fromEntries(Object.entries(slotIds).map(([slot, part]) => [part, slots[slot]]));
    expect(byPart(closing.slots)).toEqual(rects('zamkniecie-raport'));
    expect(byPart(closing.portrait.slots)).toEqual(rects('zamkniecie-raport-pion'));
  });

  it('polecenia i pytania bez form rodzajowych (-łeś/-łaś) - decyzja właściciela 2026-10-23', () => {
    const prompts = parsed.blocks.flatMap((b) => {
      const item = b as unknown as { tip?: string; prompt?: string; text?: string; options?: { text: string }[] };
      // Teksty ekranów NARRATIVE też mówią do gracza.
      const narrative = b.type === 'NARRATIVE' ? item.text : undefined;
      return [item.tip, item.prompt, narrative, ...(item.options ?? []).map((o) => o.text)].filter((t): t is string => !!t);
    });
    expect(prompts.length).toBeGreaterThan(10);
    for (const text of prompts) expect(text).not.toMatch(/\p{L}+(łeś|łaś)\b/u);
  });

  it('bez wątku kryminalnego i bez prawdziwych marek: brak oszustów, faktur i przestępców; adresy tylko .test / .example', () => {
    const sources = [JSON.stringify(raw), ...readdirSync(SCENES).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(SCENES, f), 'utf8'))].join('\n');
    expect(sources).not.toMatch(/oszu|przestęp|faktur|wyłudz|haker/i);
    const domains = [...sources.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(test|example|pl|com|net|org|eu|io|app|info|me|tv|ai))\b/gi)].map((m) => m[1]);
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
