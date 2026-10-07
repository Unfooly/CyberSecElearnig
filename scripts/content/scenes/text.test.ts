import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composeScene, composeSceneLocales, MIN_PHONE_SCREEN_TEXT_PX, MIN_TEXT_PX, PHONE_SCENE_BOX, phoneScale } from './compose.js';
import { fitText, measureText, outlineText, PATH_DECIMALS, textPathData } from './text.js';
import type { SceneSpec } from './types.js';

// Tekst wpalony w grafikę (D-135, i18n-3): kontury z czcionek z repo, teksty sceny per język (`strings`), dopasowanie do slotu z
// minimum czytelności na telefonie, deterministyczny wynik.

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Scena pionowa 900×1600 (na telefonie 'contain': 364/900 px na jednostkę) z dymkiem tekstu w dwóch językach. */
function bubbleScene(en = 'Is that you in this video?'): SceneSpec {
  return {
    width: 900,
    height: 1600,
    background: { flat: true, wall: '#4E40B8' },
    strings: {
      pl: { dymek: 'To Ty na tym filmie?', podpis: 'Kasia' },
      en: { dymek: en, podpis: 'Kasia' },
    },
    items: [
      { id: 'dymek', prop: 'textBox', x: 100, y: 200, hotspot: true, params: { w: 700, h: 260, size: 64, text: { $t: 'dymek' }, background: '#FFFFFF', padding: 24 } },
      { id: 'podpis', prop: 'textBox', x: 100, y: 520, params: { w: 400, h: 90, size: 48, text: { $t: 'podpis' }, hand: true } },
    ],
  };
}

describe('tekst jako krzywe (outlineText)', () => {
  it('każdy <text> staje się <path> z konturem; fill, opacity i klasa animacji przechodzą na ścieżkę', () => {
    const out = outlineText('<g><text x="10" y="40" font-size="20" fill="#111" opacity="0.5" class="a-blink" font-weight="bold">Zażółć</text></g>');
    expect(out).not.toMatch(/<text/);
    expect(out).toMatch(/^<g><path d="M[^"]+" fill="#111" opacity="0.5" class="a-blink"\/><\/g>$/);
  });

  it('stała precyzja współrzędnych (PATH_DECIMALS) i zakotwiczenie: middle = przesunięcie o pół szerokości', () => {
    const d = textPathData('Test', 0, 0, { size: 33 });
    for (const n of d.match(/-?\d+\.\d+/g) ?? []) expect(n.split('.')[1].length).toBeLessThanOrEqual(PATH_DECIMALS);
    const width = measureText('Test', { size: 33 });
    const firstX = (path: string) => Number(path.match(/^M(-?[\d.]+)/)![1]);
    expect(firstX(textPathData('Test', 100, 0, { size: 33, anchor: 'middle' }))).toBeCloseTo(firstX(textPathData('Test', 100 - width / 2, 0, { size: 33 })), 1);
  });

  it('brak znaku w czcionce = błąd z nazwą znaku (np. emoji); nieznany atrybut <text> = błąd (bez cichej utraty wyglądu)', () => {
    expect(() => outlineText('<text x="0" y="0" font-size="10">📎 plik</text>')).toThrow(/nie ma znaków: "📎" \(U\+1F4CE\)/);
    expect(() => outlineText('<text x="0" y="0" font-size="10" transform="rotate(5)">a</text>')).toThrow(/Atrybut <text> "transform"/);
    expect(() => outlineText('<text x="0" y="0" font-size="10" font-family="Comic Sans">a</text>')).toThrow(/Nieznana czcionka/);
  });
});

describe('dopasowanie tekstu do slotu (fitText)', () => {
  const box = { slot: 'dymek', x: 0, y: 0, w: 300, h: 80, size: 40, minSize: 20, fill: '#000', where: 'scena test, element "dymek", język en' };

  it('krótki tekst - rozmiar docelowy; dłuższy - zawija i zmniejsza, ale nie poniżej minimum', () => {
    expect(fitText('Krótki', box)).toMatch(/font-size="40"/);
    const long = fitText('This message is noticeably longer', box);
    const sizes = [...long.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...sizes)).toBeLessThan(40);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(20);
  });

  it('nie mieści się nawet przy minimum - błąd z nazwą sceny, slotu i języka (nie ucina, nie zmniejsza dalej)', () => {
    const tooLong = 'This English sentence is far too long to ever fit into such a small speech bubble on a phone, even after shrinking it';
    expect(() => fitText(tooLong, box)).toThrow(
      /scena test, element "dymek", język en, slot "dymek": tekst „This English sentence.*” nie mieści się w 300×80 nawet przy minimalnym rozmiarze 20\.0/,
    );
  });
});

describe('scena ze strings (D-135): plik na język, kontrola tekstu', () => {
  it('build per język: różne SVG, wspólne hotspoty, wynik bez <text>', () => {
    const [pl, en] = composeSceneLocales(bubbleScene(), 'dymek');
    expect([pl.locale, en.locale]).toEqual(['pl', 'en']);
    expect(pl.svg).not.toBe(en.svg);
    expect(pl.hotspots).toEqual(en.hotspots);
    expect(en.svg).not.toMatch(/<text\b|font-family/);
  });

  it('deterministyczny wynik: ta sama scena zbudowana dwa razy = identyczne bajty (hash)', () => {
    const first = composeSceneLocales(bubbleScene(), 'dymek').map((r) => sha(r.svg));
    const second = composeSceneLocales(bubbleScene(), 'dymek').map((r) => sha(r.svg));
    expect(second).toEqual(first);
  });

  it('za długi tekst EN w slocie - błąd builda ze sceną, slotem i językiem', () => {
    const tooLong =
      'Hey, is that really you in this video from the office party last Friday? Everyone in the company is sharing it right now, ' +
      'so please have a quick look at it before somebody from the management notices and the whole thing gets deleted for good';
    expect(() => composeSceneLocales(bubbleScene(tooLong), 'lancuszek-telefon')).toThrow(/scena lancuszek-telefon, element "dymek", język en, slot "text": tekst „Hey, is that really/);
  });

  it('kompletność strings: brak klucza w EN, klucz nieużyty, odwołanie do nieistniejącego klucza, nieznany język, brak pl', () => {
    const missing = bubbleScene();
    delete (missing.strings!.en as Record<string, string>).podpis;
    expect(() => composeScene(missing, { locale: 'pl' })).toThrow(/strings\.en: brak klucza "podpis"/);
    const unused = bubbleScene();
    unused.strings!.pl!.zbedny = 'x';
    unused.strings!.en!.zbedny = 'x';
    expect(() => composeScene(unused, { locale: 'pl' })).toThrow(/Klucz "zbedny" w "strings" nie jest nigdzie użyty/);
    const badRef = bubbleScene();
    badRef.items[1].params!.text = { $t: 'brak' };
    expect(() => composeScene(badRef, { locale: 'pl' })).toThrow(/nieistniejącego klucza "brak"/);
    expect(() => composeScene({ ...bubbleScene(), strings: { ...bubbleScene().strings, de: {} } as SceneSpec['strings'] }, { locale: 'pl' })).toThrow(/Nieznane języki w "strings": de/);
    expect(() => composeScene({ ...bubbleScene(), strings: { en: bubbleScene().strings!.en } }, { locale: 'en' })).toThrow(/musi mieć język "pl"/);
    expect(() => composeScene({ ...bubbleScene(), strings: undefined }, {})).toThrow(/bez "strings"/);
    expect(() => composeScene(bubbleScene(), {})).toThrow(/podaj język/);
  });

  it('odwołanie tylko w parametrze dopasowywanym do slotu (FIT_PARAMS); tekst spoza strings (domyślne etykiety klocka) - błąd', () => {
    const sticky: SceneSpec = { ...bubbleScene(), items: [...bubbleScene().items, { id: 'kartka', prop: 'stickyNote', x: 500, y: 900, params: { lines: [{ $t: 'podpis' }] } }] };
    expect(() => composeScene(sticky, { locale: 'pl' })).toThrow(/parametr "lines" klocka "stickyNote" nie jest dopasowywany do slotu/);
    const defaults: SceneSpec = { ...bubbleScene(), items: [...bubbleScene().items, { id: 'drzwi', prop: 'door', x: 500, y: 900, params: { label: 'POKÓJ' } }] };
    expect(() => composeScene(defaults, { locale: 'en' })).toThrow(/element "drzwi", język en: tekst „POKÓJ” nie pochodzi ze "strings"/);
    // Same cyfry (godzina, numer zamaskowany) - bez języka, dozwolone.
    const digits: SceneSpec = { ...bubbleScene(), items: [...bubbleScene().items, { id: 'drzwi', prop: 'door', x: 500, y: 900, params: { label: '214' } }] };
    expect(() => composeScene(digits, { locale: 'en' })).not.toThrow();
  });

  it('minimum na telefonie: 14 px (dopasowanie nie schodzi niżej), 16 px na ekranie telefonu; decorative - bez minimum', () => {
    // Scena 900×1600 w trybie contain: min(364/900, 631/1600) = 631/1600 px na jednostkę -> 14 px = 35,5 jednostki.
    const tiny = (extra: Partial<SceneSpec['items'][number]> = {}): SceneSpec => ({
      ...bubbleScene(),
      items: [
        bubbleScene().items[0],
        { id: 'podpis', prop: 'textBox', x: 100, y: 520, params: { w: 600, h: 30, size: 28, text: { $t: 'podpis' } }, ...extra },
      ],
    });
    expect(() => composeScene(tiny(), { locale: 'pl', name: 'mala' })).toThrow(/scena mala, element "podpis", język pl, slot "text": rozmiar 28 poniżej minimum 35\.5/);
    expect(() => composeScene(tiny({ decorative: true }), { locale: 'pl' })).not.toThrow();
    // Ekran telefonu: 16 px = 40,6 jednostki - rozmiar 36 (≥ 14 px, < 16 px) przechodzi zwykle, a na ekranie telefonu nie.
    const screen = (phoneScreen: boolean): SceneSpec => ({
      ...bubbleScene(),
      items: [bubbleScene().items[0], { id: 'podpis', prop: 'textBox', x: 100, y: 520, phoneScreen, params: { w: 600, h: 60, size: 36, text: { $t: 'podpis' } } }],
    });
    expect(() => composeScene(screen(false), { locale: 'pl' })).not.toThrow();
    expect(() => composeScene(screen(true), { locale: 'pl' })).toThrow(/poniżej minimum 40\.6/);
    expect(MIN_TEXT_PX).toBe(14);
    expect(MIN_PHONE_SCREEN_TEXT_PX).toBe(16);
  });

  it('skala telefonu jak w odtwarzaczu: contain = cała scena w 364×631, panorama = pełna wysokość obszaru', () => {
    expect(PHONE_SCENE_BOX).toEqual({ width: 364, height: 631 });
    expect(phoneScale({ width: 900, height: 1600, items: [] })).toBeCloseTo(631 / 1600);
    expect(phoneScale({ width: 900, height: 1100, items: [] })).toBeCloseTo(364 / 900);
    expect(phoneScale({ width: 1600, height: 900, items: [] })).toBeCloseTo(364 / 1600);
    expect(phoneScale({ width: 1600, height: 900, phone: 'panorama', items: [] })).toBeCloseTo(631 / 900);
  });
});
