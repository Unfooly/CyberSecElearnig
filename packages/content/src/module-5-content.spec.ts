import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toClientBlock } from './index';
import { moduleWarnings, parseModule } from './node';

// Moduł 5 „Najłatwiejsze drzwi” (bezpieczeństwo sieci) - treść zgodna ze scenariuszem zatwierdzonym przez właściciela 2026-11-16
// (docs/modules/modul-5-najlatwiejsze-drzwi.md): start → wideo → 4 pytania wielokrotnego wyboru (D-158) → podsumowanie z samymi zasadami.
// Lektor `lektor-siec` czyta start, każde pytanie i podsumowanie; wideo z potoku zasobów (D-159) bez narracji; klucz nie idzie do klienta.
const MODULE_5 = join(__dirname, '..', 'modules', 'najlatwiejsze-drzwi', 'module.json');
const raw = JSON.parse(readFileSync(MODULE_5, 'utf8'));
const parsed = parseModule(raw);
const block = (id: string) => parsed.blocks.find((b) => b.id === id)! as unknown as Record<string, unknown>;
const context = { shuffleSeed: () => [1, 2, 3, 4] as [number, number, number, number], opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}` };
const QUIZZES = ['ktos-za-toba', 'cos-podpiete', 'gosc-prosi', 'poza-biurem'];
type Option = { text: string; correct: boolean; feedback: string };

describe('moduł 5 „Najłatwiejsze drzwi” - treść', () => {
  it('waliduje się w trybie prostym, tylko po polsku, kategoria IT_HYGIENE, bez ostrzeżeń', () => {
    expect(parsed.simpleMode).toBe(true);
    expect(parsed.locales).toEqual(['pl']);
    expect(parsed.category).toBe('IT_HYGIENE');
    expect(moduleWarnings(parsed)).toEqual([]);
  });

  it('kolejność bloków ze scenariusza: start, wideo, 4 pytania, podsumowanie', () => {
    expect(parsed.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      'start:BRIEFING',
      'film:VIDEO',
      ...QUIZZES.map((id) => `${id}:QUIZ`),
      'podsumowanie:SUMMARY',
    ]);
  });

  it('start: jeden ekran z opisem, jedną grafiką i przyciskiem „Zaczynamy”', () => {
    const steps = block('start').steps as { kind: string; nextLabel?: string; image?: string; text: string }[];
    expect(steps).toHaveLength(1);
    // Ostatni krok: przycisk „Zaczynamy” to etykieta „Dalej” w pasku (D-160).
    expect(steps[0]).toMatchObject({ kind: 'typewriter', nextLabel: 'Zaczynamy' });
    // Grafiki z ElevenLabs w stylu Unfooly (D-161): WebP, osobno poziomo i pionowo; miniatura modułu w katalogu.
    expect(steps[0].image).toMatch(/^assets\/najlatwiejsze-drzwi\/images\/start\.[0-9a-f]{8}\.webp$/);
    expect((steps[0] as { portrait?: { image: string } }).portrait?.image).toMatch(/^assets\/najlatwiejsze-drzwi\/images\/start-pion\.[0-9a-f]{8}\.webp$/);
    expect(parsed.thumbnail).toMatch(/^assets\/najlatwiejsze-drzwi\/images\/miniatura\.[0-9a-f]{8}\.webp$/);
    expect(steps[0].text).toMatch(/^Przestępca nie musi łamać zabezpieczeń/);
  });

  it('wideo: osobny plik PL i EN z potoku zasobów (opublikowane klucze), bez zewnętrznego adresu i bez narracji', () => {
    const film = block('film');
    // Lektor i napisy wpalone w obraz - osobny plik na język (lvideo, D-159); EN czeka na wersję EN modułu (locales).
    const src = film.src as { pl: string; en: string };
    expect(src.pl).toMatch(/^assets\/najlatwiejsze-drzwi\/video\/film\.[0-9a-f]{8}\.mp4$/);
    expect(src.en).toMatch(/^assets\/najlatwiejsze-drzwi\/video\/film-en\.[0-9a-f]{8}\.mp4$/);
    expect(film.url).toBeUndefined();
    expect(film.narration).toBeUndefined();
  });

  it('lektor `lektor-siec` czyta start, każde pytanie (tekstem pytania) i podsumowanie; wszystkie nagrania opublikowane', () => {
    const narrations = [
      (block('start').steps as { narration: Record<string, unknown> }[])[0].narration,
      ...QUIZZES.map((id) => block(id).narration as Record<string, unknown>),
      block('podsumowanie').narration as Record<string, unknown>,
    ];
    for (const narration of narrations) {
      expect(narration.voice).toBe('lektor-siec');
      expect(narration.audioUrl).toMatch(/^audio\/najlatwiejsze-drzwi\/v1\//);
    }
    for (const id of QUIZZES) expect((block(id).narration as { text: string }).text).toBe(block(id).prompt);
  });

  it('pytania: wielokrotny wybór, 4 odpowiedzi, co najmniej jedna poprawna i jedna błędna, podpowiedź; wskazane poprawne', () => {
    const correct = (id: string) => (block(id).options as Option[]).flatMap((o, i) => (o.correct ? [i] : []));
    for (const id of QUIZZES) {
      expect(block(id).multiple).toBe(true);
      expect(block(id).options).toHaveLength(4);
      expect(typeof block(id).hint).toBe('string');
    }
    expect(correct('ktos-za-toba')).toEqual([0, 2]);
    expect(correct('cos-podpiete')).toEqual([0, 1, 3]);
    expect(correct('gosc-prosi')).toEqual([1, 3]);
    expect(correct('poza-biurem')).toEqual([0, 1]);
  });

  it('podsumowanie: same zasady - trzy zasady dosłownie, bez pieczęci i raportu w teczce', () => {
    const summary = block('podsumowanie');
    expect(summary.closing).toBeUndefined();
    for (const rule of [
      'Wchodzisz swoją kartą – nikogo nie wpuszczasz za sobą, a obcych pytasz, do kogo przyszli.',
      'Nie podłączasz nieznanych urządzeń ani znalezionych nośników – zgłaszasz je do IT.',
      'Goście dostają sieć dla gości, a ty logujesz się z kodem i przez VPN poza biurem.',
    ]) {
      expect(summary.text).toContain(rule);
    }
  });

  it('polecenia i odpowiedzi bez form rodzajowych gracza (-łeś/-łaś); bez prawdziwych domen', () => {
    const texts = QUIZZES.flatMap((id) => [block(id).prompt as string, ...(block(id).options as Option[]).map((o) => o.text)]);
    for (const text of texts) expect(text).not.toMatch(/\p{L}+(łeś|łaś)\b/u);
    const domains = [...JSON.stringify(raw).matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(pl|com|net|org|eu|io|app|info))\b/gi)].map((m) => m[1]);
    expect(domains).toEqual([]);
  });

  it('klient nie dostaje klucza odpowiedzi, zdań po wyborze ani podpowiedzi', () => {
    for (const id of QUIZZES) {
      const client = JSON.stringify(toClientBlock(block(id) as never, context));
      expect(client).not.toMatch(/"correct"|"feedback"|"hint"/);
      expect(client).toContain('"multiple":true');
    }
  });
});
