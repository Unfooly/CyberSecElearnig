import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ContentValidationError,
  FIELD_CLASSIFICATION,
  ShuffleSeed,
  collectPaths,
  isLocalizedSchema,
  leafPaths,
  localesIn,
  localizeContent,
  localizedPaths,
  missingTranslations,
  moduleSchema,
  narrationSchema,
  toClientBlock,
} from './index';
import { SECRET_MARKER, fullModule } from './fixtures';
import { moduleWarnings, parseModule } from './node';

// Format wielojęzyczny (schemaVersion 6, faza 1a modułu 2 - docs/modules/modul-2-glos-z-helpdesku.md rozdz. 10, D-114).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

const context = {
  shuffleSeed: (blockId: string): ShuffleSeed => [blockId.length, 7, 11, 13],
  opaqueId: (blockId: string, itemId: string) => `x${blockId}-${itemId}`,
};

const errorsOf = (module: unknown): string => {
  try {
    parseModule(module);
  } catch (e) {
    return (e as ContentValidationError).issues.join('\n');
  }
  return '';
};

const block = (m: AnyModule, type: string) => m.blocks.find((b: AnyModule) => b.type === type);

/** fullModule() podniesiony do v6: tytuł, tekst i narracja NARRATIVE wielojęzyczne (narracja z rolą karol, EN bez nagrania). */
function v6Module(): AnyModule {
  const m = fullModule() as AnyModule;
  m.schemaVersion = 6;
  m.title = { pl: 'Sprawa testowa', en: 'Test case' };
  const narrative = block(m, 'NARRATIVE');
  narrative.text = { pl: narrative.text, en: 'Tuesday, 9:40. Fourteen thousand zloty is gone.' };
  const { voice: _voice, ...pl } = narrative.narration;
  narrative.narration = { voice: 'karol', pl, en: { text: 'Opening. Second sentence.' } };
  return m;
}

describe('localizeContent: rozwinięcie do jednego języka', () => {
  it('string zostaje, { pl, en } daje wybrany język, brak języka w polu = pl (fallback pole po polu)', () => {
    const value = { a: 'tylko pl', b: { pl: 'dzień dobry', en: 'good morning' }, c: { pl: 'bez tłumaczenia' }, list: [{ pl: 'x', en: 'y' }] };
    expect(localizeContent(value, 'en')).toEqual({ a: 'tylko pl', b: 'good morning', c: 'bez tłumaczenia', list: ['y'] });
    expect(localizeContent(value, 'pl')).toEqual({ a: 'tylko pl', b: 'dzień dobry', c: 'bez tłumaczenia', list: ['x'] });
    expect(localizeContent(value)).toEqual(localizeContent(value, 'pl'));
  });

  it('narracja wielojęzyczna -> płaska narracja wybranego języka ze wspólną rolą głosu', () => {
    const narration = { voice: 'oszust', pl: { text: 'Tu IT Helpdesk.', spokenText: 'Tu IT helpdesk.' }, en: { text: 'IT Helpdesk here.' } };
    expect(localizeContent({ narration }, 'en')).toEqual({ narration: { voice: 'oszust', text: 'IT Helpdesk here.' } });
    expect(localizeContent({ narration }, 'pl')).toEqual({ narration: { voice: 'oszust', text: 'Tu IT Helpdesk.', spokenText: 'Tu IT helpdesk.' } });
  });

  it('nie zmienia wejścia i nie da się nim podmienić prototypu', () => {
    const value = JSON.parse('{"t":{"pl":"a","en":"b"},"__proto__":{"polluted":true}}');
    const copy = JSON.parse(JSON.stringify(value));
    const result = localizeContent(value, 'en') as Record<string, unknown>;
    expect(value).toEqual(copy);
    expect(result.t).toBe('b');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('localesIn / localizedPaths / missingTranslations', () => {
    const value = { a: { pl: 'x' }, b: [{ pl: 'y', en: 'Y' }], n: { voice: 'karol', pl: { text: 'z' } } };
    expect(localesIn(value)).toEqual(['pl', 'en']);
    expect(localesIn({ a: 'x' })).toEqual(['pl']);
    expect(localizedPaths(value)).toEqual(['a', 'b[0]', 'n']);
    expect(missingTranslations(value, 'en')).toEqual(['a', 'n']);
  });
});

describe('moduł 1 (v5, jednojęzyczny): rozwinięcie języka to tożsamość', () => {
  const parsed = parseModule(JSON.parse(readFileSync(join(__dirname, '..', 'modules', 'wyludzone-haslo', 'module.json'), 'utf8')));

  it('pl i en dają ten sam JSON co zapisana treść (bez pól wielojęzycznych, bez ostrzeżeń o tłumaczeniu)', () => {
    expect(localizedPaths(parsed)).toEqual([]);
    expect(localesIn(parsed)).toEqual(['pl']);
    expect(JSON.stringify(localizeContent(parsed, 'pl'))).toBe(JSON.stringify(parsed));
    expect(JSON.stringify(localizeContent(parsed, 'en'))).toBe(JSON.stringify(parsed));
    expect(moduleWarnings(parsed).filter((w) => w.startsWith('brak tłumaczenia'))).toEqual([]);
  });
});

describe('schemat v6: pola wielojęzyczne', () => {
  it('żaden schemat treści nie ma pola `pl` ani `en` poza polami wielojęzycznymi (rozpoznanie po kształcie jest jednoznaczne)', () => {
    const keys = new Set<string>();
    const seen = new Set<z.ZodTypeAny>();
    const walk = (schema: z.ZodTypeAny): void => {
      if (seen.has(schema)) return;
      seen.add(schema);
      const def = schema._def as Record<string, any>;
      if (isLocalizedSchema(schema)) return walk(def.options[0]);
      switch (def.typeName) {
        case 'ZodOptional':
        case 'ZodNullable':
        case 'ZodDefault':
          return walk(def.innerType);
        case 'ZodEffects':
          return walk(def.schema);
        case 'ZodArray':
          return walk(def.type);
        case 'ZodTuple':
          return def.items.forEach(walk);
        case 'ZodUnion':
        case 'ZodDiscriminatedUnion':
          return def.options.forEach(walk);
        case 'ZodObject':
          for (const [key, value] of Object.entries((schema as z.AnyZodObject).shape)) {
            keys.add(key);
            walk(value as z.ZodTypeAny);
          }
          return;
        default:
          return;
      }
    };
    walk(moduleSchema);
    expect(keys.size).toBeGreaterThan(50);
    expect(keys.has('pl')).toBe(false);
    expect(keys.has('en')).toBe(false);
  });

  it('leafPaths pola wielojęzycznego = ścieżki wariantu jednojęzycznego (klasyfikacja niezależna od języka)', () => {
    expect(leafPaths(narrationSchema, 'narration').sort()).toEqual(
      ['narration.text', 'narration.voice', 'narration.spokenText', 'narration.audioUrl', 'narration.durationMs', 'narration.cues[].text', 'narration.cues[].startMs'].sort(),
    );
  });

  it('moduł v6 z polami wielojęzycznymi, rolą karol i tylko częścią tłumaczeń przechodzi; zapis zachowuje oba języki', () => {
    const parsed = parseModule(v6Module()) as AnyModule;
    expect(parsed.title).toEqual({ pl: 'Sprawa testowa', en: 'Test case' });
    expect(block(parsed, 'NARRATIVE').narration.voice).toBe('karol');
    expect(localizeContent(parsed, 'en').title).toBe('Test case');
  });

  it('moduł v6 tylko po polsku (moduł 2) nie dostaje ostrzeżeń o tłumaczeniu; częściowe EN - dostaje, z ścieżką', () => {
    const plOnly = v6Module();
    plOnly.title = { pl: 'Sprawa testowa' };
    const narrative = block(plOnly, 'NARRATIVE');
    narrative.text = { pl: narrative.text.pl };
    delete narrative.narration.en;
    expect(moduleWarnings(parseModule(plOnly)).filter((w) => w.startsWith('brak tłumaczenia'))).toEqual([]);

    const partial = v6Module();
    delete block(partial, 'NARRATIVE').narration.en;
    expect(moduleWarnings(parseModule(partial))).toContain('brak tłumaczenia EN: blocks[0].narration');
  });

  it('błąd w jednym języku ma pełną ścieżkę pola (bez ogólnego „Invalid input”); brak pl to błąd', () => {
    const tooLong = v6Module();
    tooLong.title = { pl: 'Sprawa', en: 'x'.repeat(201) };
    expect(errorsOf(tooLong)).toMatch(/^title\.en: /m);

    const noPl = v6Module();
    noPl.title = { en: 'Test case' };
    expect(errorsOf(noPl)).toMatch(/^title/m);
    expect(errorsOf(noPl)).not.toContain('Invalid input');

    const badVoice = v6Module();
    block(badVoice, 'NARRATIVE').narration.voice = 'lektor2';
    expect(errorsOf(badVoice)).toContain('narration.voice');

    const unknownLocale = v6Module();
    unknownLocale.title = { pl: 'Sprawa', de: 'Fall' };
    expect(errorsOf(unknownLocale)).toMatch(/^title/m);

    // Obiekt bez `pl` w polu tekstowym: podpowiedź zamiast „Expected string, received object”.
    const noPlHint = v6Module();
    noPlHint.subtitle = { PL: 'Podtytuł' };
    expect(errorsOf(noPlHint)).toContain('subtitle: pole wielojęzyczne wymaga klucza "pl"');
  });

  it('moduleSchema wprost (harness): zły voice w PŁASKIEJ narracji ma komunikat z gałęzi płaskiej, nie „pl: Required”', () => {
    const m = v6Module();
    block(m, 'VIDEO').narration.voice = 'lektor2';
    const result = moduleSchema.safeParse(m);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.join('\n')).toMatch(/voice: Invalid enum value/);
    expect(messages.join('\n')).not.toMatch(/pl: Required/);
  });

  it('reguły semantyczne sprawdzane w każdym języku: błąd tylko w EN ma prefiks [en]', () => {
    const quote = v6Module();
    const email = block(quote, 'EMAIL_ANALYSIS');
    email.email.body = { pl: email.email.body, en: 'Please verify your account.' };
    expect(errorsOf(quote)).toMatch(/^\[en\] .*quote/m);

    const digits = v6Module();
    block(digits, 'NARRATIVE').narration.en = { text: 'At 9:40 the money was gone.' };
    const errors = errorsOf(digits);
    expect(errors).toMatch(/^\[en\] .*cyfry w tekście czytanym przez lektora/m);
    expect(errors.split('\n').filter((line) => line.includes('cyfry'))).toHaveLength(1);

    const fixed = v6Module();
    block(fixed, 'NARRATIVE').narration.en = { text: 'At 9:40 the money was gone.', spokenText: 'At nine forty the money was gone.' };
    expect(errorsOf(fixed)).toBe('');
  });
});

describe('schemat v6: nowości tylko od schemaVersion 6', () => {
  it('pola wielojęzyczne, textLayer, notatki call/log/web i role karol/pawel/oszust w module v5 to błąd', () => {
    const localized = v6Module();
    localized.schemaVersion = 5;
    expect(errorsOf(localized)).toMatch(/pola wielojęzyczne \(\{ pl, en \}\) wymagają schemaVersion 6/);

    const layer = fullModule() as AnyModule;
    block(layer, 'SCENE_HOTSPOTS').textLayer = [{ id: 'szyld', x: 1, y: 1, w: 10, h: 5, text: 'Wejście' }];
    expect(errorsOf(layer)).toContain('textLayer wymaga schemaVersion 6');

    const kind = fullModule() as AnyModule;
    const note = block(kind, 'SCENE_HOTSPOTS').hotspots.find((h: AnyModule) => h.note).note;
    note.kind = 'call';
    expect(errorsOf(kind)).toContain('rodzaj notatki "call" wymaga schemaVersion 6');

    for (const voice of ['karol', 'pawel', 'oszust']) {
      const role = fullModule() as AnyModule;
      block(role, 'NARRATIVE').narration.voice = voice;
      expect(errorsOf(role)).toContain(`rola głosu "${voice}" wymaga schemaVersion 6`);
    }
  });

  it('w module v6 te same nowości przechodzą (call, log, web; karol, pawel, oszust; textLayer)', () => {
    for (const kind of ['call', 'log', 'web']) {
      const m = v6Module();
      block(m, 'SCENE_HOTSPOTS').hotspots.find((h: AnyModule) => h.note).note.kind = kind;
      expect(errorsOf(m)).toBe('');
    }
    for (const voice of ['karol', 'pawel', 'oszust']) {
      const m = v6Module();
      block(m, 'NARRATIVE').narration.voice = voice;
      expect(errorsOf(m)).toBe('');
    }
  });
});

describe('textLayer (schemaVersion 6)', () => {
  const withLayer = (layer: unknown[]) => {
    const m = v6Module();
    block(m, 'SCENE_HOTSPOTS').textLayer = layer;
    return m;
  };

  it('poprawna warstwa (także wielojęzyczna, z wariantem pionowym) przechodzi', () => {
    expect(
      errorsOf(withLayer([{ id: 'szyld', x: 10, y: 5, w: 20, h: 6, text: { pl: 'Księgowość', en: 'Accounting' }, style: 'sign', portrait: { x: 5, y: 10, w: 50, h: 5 } }])),
    ).toBe('');
  });

  it('prostokąt poza grafiką, powtórzone id i nieznany styl to błąd', () => {
    expect(errorsOf(withLayer([{ id: 'a', x: 90, y: 5, w: 20, h: 6, text: 'X' }]))).toContain('prostokąt wychodzi poza grafikę');
    expect(errorsOf(withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', portrait: { x: 1, y: 98, w: 5, h: 5 } }]))).toContain('pionową grafikę');
    expect(errorsOf(withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X' }, { id: 'a', x: 1, y: 10, w: 5, h: 5, text: 'Y' }]))).toContain('powtórzony identyfikator "a"');
    expect(errorsOf(withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', style: 'neon' }]))).toContain('textLayer');
  });

  it('kolor tekstu (`tone`, D-128): dark i light przechodzą i trafiają do klienta; inna wartość to błąd', () => {
    expect(errorsOf(withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', tone: 'dark' }, { id: 'b', x: 1, y: 10, w: 5, h: 5, text: 'Y', tone: 'light' }]))).toBe('');
    expect(errorsOf(withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', tone: 'neon' }]))).toContain('textLayer');
    const m = withLayer([{ id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', tone: 'light' }, { id: 'b', x: 1, y: 10, w: 5, h: 5, text: 'Y' }]);
    const client = toClientBlock(block(m, 'SCENE_HOTSPOTS'), context);
    expect(client.textLayer).toEqual([
      { id: 'a', x: 1, y: 1, w: 5, h: 5, text: 'X', tone: 'light' },
      { id: 'b', x: 1, y: 10, w: 5, h: 5, text: 'Y' },
    ]);
  });
});

describe('toClientBlock: język gracza, bez wycieku innych języków ani sekretów', () => {
  const localizedDialogue = () => {
    const m = v6Module();
    const narrative = block(m, 'NARRATIVE');
    const email = block(m, 'EMAIL_ANALYSIS');
    // Sekret (explanation) wielojęzyczny: nie może wyjść w ŻADNYM języku.
    email.criteria[0].explanation = { pl: `${SECRET_MARKER}-pl`, en: `${SECRET_MARKER}-en` };
    return { narrative, email };
  };

  it('klient dostaje wybrany język (EN), a pola bez EN - polski; żadnych obiektów { pl, en } w odpowiedzi', () => {
    const { narrative } = localizedDialogue();
    const en = toClientBlock(narrative, { ...context, locale: 'en' });
    expect(en.text).toBe('Tuesday, 9:40. Fourteen thousand zloty is gone.');
    expect(en.narration).toEqual({ text: 'Opening. Second sentence.' });
    expect(en.title).toBe('Blok otwarcie');
    const pl = toClientBlock(narrative, context);
    expect(pl.text).toBe('Wtorek, 9:40. Zniknęło czternaście tysięcy złotych.');
    for (const projected of [en, pl]) {
      expect(collectPaths(projected).some((path) => /(^|\.)(pl|en)(\.|$)/.test(path))).toBe(false);
      expect(JSON.stringify(projected)).not.toContain('karol');
    }
  });

  it('sekret wielojęzyczny nie wychodzi w żadnym języku; ścieżki odpowiedzi tylko z listy client', () => {
    const { email } = localizedDialogue();
    for (const locale of ['pl', 'en'] as const) {
      const projected = toClientBlock(email, { ...context, locale });
      expect(JSON.stringify(projected)).not.toContain(SECRET_MARKER);
      for (const path of collectPaths(projected)) expect(FIELD_CLASSIFICATION.EMAIL_ANALYSIS.client).toContain(path);
    }
  });
});
