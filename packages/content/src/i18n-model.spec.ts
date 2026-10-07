import { BLOCK_SCHEMAS, ContentValidationError, DYNAMIC_OVERLAY_SLOTS, leafPaths, toClientBlock } from './index';
import { fullModuleV6, simpleModule } from './fixtures';
import { moduleWarnings, parseModule } from './node';

// Model treści i18n (D-133, i18n-2): grafiki z wpalonym tekstem osobne na język, opisy alt, kompletność języków z `locales`, textLayer
// przestarzały, lista nakładek HTML z wartościami dynamicznymi.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

const errorsOf = (module: unknown): string => {
  try {
    parseModule(module);
  } catch (e) {
    return (e as ContentValidationError).issues.join('\n');
  }
  return '';
};

/** Mały moduł dwujęzyczny: odprawa ze sceną, scena z hotspotem, raport. */
function bilingual(): AnyModule {
  return {
    schemaVersion: 6,
    slug: 'dwujezyczny',
    title: { pl: 'Łańcuszek', en: 'The chain' },
    category: 'EMAIL_SECURITY',
    durationMinutes: 5,
    mandatory: false,
    locales: ['pl', 'en'],
    blocks: [
      {
        id: 'odprawa',
        type: 'BRIEFING',
        steps: [
          {
            kind: 'start',
            text: { pl: 'Zaczynamy.', en: 'Let us begin.' },
            cta: { pl: 'Start', en: 'Start' },
            image: { pl: 'scenes/pl/odprawa.svg', en: 'scenes/en/odprawa.svg' },
            alt: { pl: 'Biurko z telefonem.', en: 'A desk with a phone.' },
          },
        ],
      },
      {
        id: 'telefon',
        type: 'SCENE_HOTSPOTS',
        tip: { pl: 'Kliknij link.', en: 'Click the link.' },
        image: { pl: 'scenes/pl/telefon.svg', en: 'scenes/en/telefon.svg' },
        imageAlt: { pl: 'Telefon z wiadomością „To Ty?”.', en: 'A phone with the message “Is that you?”.' },
        hotspots: [{ id: 'link', label: { pl: 'Link do filmu', en: 'Video link' }, x: 10, y: 10, width: 30, height: 20, content: { pl: 'Link.', en: 'Link.' } }],
      },
      { id: 'raport', type: 'SUMMARY', lessons: [{ pl: 'Nie klikaj.', en: 'Do not click.' }] },
    ],
  };
}

describe('model treści i18n (D-133)', () => {
  it('moduł dwujęzyczny z grafikami osobnymi na język przechodzi walidację', () => {
    expect(errorsOf(bilingual())).toBe('');
  });

  it('każdy język z locales jest kompletny: brak EN w grafice, opisie, etykiecie hotspotu albo tekście - błąd ze ścieżką', () => {
    const m = bilingual();
    m.blocks[1].image = { pl: 'scenes/pl/telefon.svg' };
    m.blocks[1].imageAlt = 'Telefon.';
    m.blocks[1].hotspots[0].label = { pl: 'Link' };
    const errors = errorsOf(m);
    expect(errors).toMatch(/blocks\[1\]\.image: brak języka "en"/);
    expect(errors).toMatch(/blocks\[1\]\.hotspots\[0\]\.label: brak języka "en"/);
    // Zwykły string = tylko `pl` - w module z EN też brak języka (nie cichy fallback).
    expect(errorsOf({ ...bilingual(), title: 'Łańcuszek' })).toMatch(/title: brak języka "en"/);
  });

  it('każda grafika ma opis: krok odprawy z obrazem bez alt - błąd w module z locales; bez locales (moduły 1-2) - bez zmian', () => {
    const m = bilingual();
    delete m.blocks[0].steps[0].alt;
    expect(errorsOf(m)).toMatch(/blocks\[0\] \(odprawa\): steps\[0\]: grafika bez opisu alt/);
    const old = bilingual();
    delete old.locales;
    delete old.blocks[0].steps[0].alt;
    expect(errorsOf(old)).toBe('');
  });

  it('textLayer: w module z locales - błąd; w module bez locales - ostrzeżenie', () => {
    const layer = [{ id: 'napis', x: 1, y: 1, w: 10, h: 5, text: { pl: 'Napis', en: 'Label' } }];
    const m = bilingual();
    m.blocks[1].textLayer = layer;
    expect(errorsOf(m)).toMatch(/blocks\[1\]\.textLayer: textLayer jest przestarzałe w modułach z locales/);
    const old = bilingual();
    delete old.locales;
    old.blocks[1].textLayer = layer;
    expect(errorsOf(old)).toBe('');
    expect(moduleWarnings(parseModule(old)).join('\n')).toMatch(/blocks\[1\]\.textLayer: textLayer jest przestarzałe \(D-133\)/);
  });

  it('kurs tylko PL (locales [pl], moduł 3 na start) przechodzi ze zwykłymi ścieżkami; moduł 2 bez locales - bez zmian', () => {
    expect(errorsOf({ ...simpleModule(), locales: ['pl'] })).toBe('');
    expect(errorsOf(fullModuleV6())).toBe('');
  });

  it('projekcja do klienta: grafika i opis w języku gracza (toClientBlock)', () => {
    const scene = parseModule(bilingual()).blocks[1] as unknown as Record<string, unknown>;
    const context = { shuffleSeed: () => [1, 2, 3, 4] as const, opaqueId: (_b: string, i: string) => i };
    expect(toClientBlock(scene, { ...context, locale: 'en' })).toMatchObject({ image: 'scenes/en/telefon.svg', imageAlt: 'A phone with the message “Is that you?”.' });
    expect(toClientBlock(scene, { ...context, locale: 'pl' })).toMatchObject({ image: 'scenes/pl/telefon.svg' });
    expect((toClientBlock(scene, { ...context, locale: 'en' }).hotspots as { label: string }[])[0].label).toBe('Video link');
  });

  it('nakładki HTML tylko z listy wartości dynamicznych: sloty w SCHEMACIE = DYNAMIC_OVERLAY_SLOTS (+ miejsca na grafiki raportu)', () => {
    // Nazwy slotów ze schematu (leafPaths): nowy slot bez wpisu na liście (albo odwrotnie) wywala ten test.
    const slotsOf = (type: 'BRIEFING' | 'SUMMARY', prefix: string) =>
      [...new Set(leafPaths(BLOCK_SCHEMAS[type]).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split('.')[0]))].sort();
    expect(slotsOf('BRIEFING', 'steps[].slots.')).toEqual([...DYNAMIC_OVERLAY_SLOTS.BRIEFING].sort());
    expect(slotsOf('BRIEFING', 'steps[].portrait.slots.')).toEqual([...DYNAMIC_OVERLAY_SLOTS.BRIEFING].sort());
    expect(slotsOf('SUMMARY', 'closing.slots.')).toEqual([...DYNAMIC_OVERLAY_SLOTS.SUMMARY, 'note', 'stamp'].sort());
  });

  it('brakujące przypadki: opis sceny bez EN, raport bez opisów, narracja bez EN, { pl, en } w module v5, zła ścieżka EN', () => {
    const noAltEn = bilingual();
    noAltEn.blocks[1].imageAlt = 'Telefon.';
    expect(errorsOf(noAltEn)).toMatch(/blocks\[1\]\.imageAlt: brak języka "en"/);

    const closing = bilingual();
    closing.blocks[2].closing = {
      image: { pl: 'scenes/pl/raport.svg', en: 'scenes/en/raport.svg' },
      stamp: { pl: 'scenes/pl/pieczec.svg', en: 'scenes/en/pieczec.svg' },
      note: { pl: 'scenes/pl/liscik.svg', en: 'scenes/en/liscik.svg' },
      slots: Object.fromEntries(['evidence', 'time', 'xp', 'lessons', 'signature', 'stamp', 'note'].map((slot, i) => [slot, { x: 1, y: i * 10, w: 10, h: 5 }])),
    };
    const closingErrors = errorsOf(closing);
    expect(closingErrors).toMatch(/closing: grafika bez opisu alt/);
    expect(closingErrors).toMatch(/closing\.stamp \(stampAlt\): grafika bez opisu alt/);
    expect(closingErrors).toMatch(/closing\.note \(noteAlt\): grafika bez opisu alt/);

    const caseFile = bilingual();
    caseFile.blocks[0].steps.push({
      kind: 'caseFile',
      caseNo: 'CS/1',
      title: { pl: 'Sprawa', en: 'Case' },
      fields: [{ label: { pl: 'Strata', en: 'Loss' }, value: { pl: '1 PLN', en: 'PLN 1' } }],
      cta: { pl: 'Zamknij', en: 'Close' },
      closedImage: { pl: 'scenes/pl/teczka.svg', en: 'scenes/en/teczka.svg' },
      image: { pl: 'scenes/pl/akta.svg', en: 'scenes/en/akta.svg' },
      alt: { pl: 'Akta.', en: 'Files.' },
    });
    expect(errorsOf(caseFile)).toMatch(/steps\[1\]\.closedImage \(closedAlt\): grafika bez opisu alt/);

    const narration = bilingual();
    narration.blocks[0].steps[0].narration = { pl: { text: 'Zaczynamy.' } };
    expect(errorsOf(narration)).toMatch(/blocks\[0\]\.steps\[0\]\.narration: brak języka "en"/);

    const v5: AnyModule = { ...bilingual(), schemaVersion: 5 };
    delete v5.locales;
    expect(errorsOf(v5)).toMatch(/pola wielojęzyczne \(\{ pl, en \}\) wymagają schemaVersion 6/);

    for (const bad of ['../x.svg', 'https://evil.example/x.svg', '/abs/x.svg']) {
      const m = bilingual();
      m.blocks[1].image = { pl: 'scenes/pl/telefon.svg', en: bad };
      expect(errorsOf(m)).toMatch(/blocks\.1\.image/);
    }
    const extraKey = bilingual();
    extraKey.blocks[1].image = { pl: 'scenes/pl/telefon.svg', de: 'scenes/de/telefon.svg' };
    expect(errorsOf(extraKey)).not.toBe('');
  });
});
