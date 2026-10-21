import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONTENT_LOCALE, localizeContent, moduleSchema, toClientBlock, type ServerBlock } from '@cyberszkolo/content';
import { describe, expect, it } from 'vitest';
import { pseudoLocalizeClientContent } from './pseudo-content';

// Pola, które w podglądzie xx wolno zmienić (tekst do czytania). Nowe pole w treści modułu z `locales`: tekst - dopisz tutaj; pole
// sterujące albo identyfikator - dopisz do TECHNICAL_KEYS w pseudo-content.ts (inaczej podgląd xx po cichu psuje porównania odtwarzacza).
const TEXT_KEYS = new Set(['title', 'text', 'cta', 'alt', 'tip', 'imageAlt', 'label', 'content', 'prompt', 'from', 'attachment', 'stampAlt', 'noteAlt']);

/** Klucze (ostatni segment ścieżki, bez indeksów list) wartości tekstowych, które różnią się między `a` i `b`. */
function changedKeys(a: unknown, b: unknown, key = '', out = new Set<string>()): Set<string> {
  if (typeof a === 'string') {
    if (a !== b) out.add(key);
  } else if (Array.isArray(a)) a.forEach((item, index) => changedKeys(item, (b as unknown[])[index], key, out));
  else if (a && typeof a === 'object') for (const [name, item] of Object.entries(a)) changedKeys(item, (b as Record<string, unknown>)[name], name, out);
  return out;
}

const modulesRoot = path.join(__dirname, '..', '..', '..', '..', '..', 'packages', 'content', 'modules');
const localizedModules = fs
  .readdirSync(modulesRoot)
  .filter((slug) => fs.existsSync(path.join(modulesRoot, slug, 'module.json')))
  .map((slug) => ({ slug, raw: JSON.parse(fs.readFileSync(path.join(modulesRoot, slug, 'module.json'), 'utf8')) as { locales?: unknown } }))
  .filter(({ raw }) => Array.isArray(raw.locales));

describe('pseudoLocalizeClientContent na treści modułów z `locales` (D-143)', () => {
  it('są moduły do sprawdzenia', () => {
    expect(localizedModules.length).toBeGreaterThan(0);
  });

  it.each(localizedModules.map(({ slug, raw }) => [slug, raw] as const))('%s: w xx zmieniają się wyłącznie pola tekstowe', (_slug, raw) => {
    const parsed = localizeContent(moduleSchema.parse(raw), DEFAULT_CONTENT_LOCALE);
    for (const block of parsed.blocks as ServerBlock[]) {
      const client = toClientBlock(block, { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (_blockId, itemId) => itemId });
      const changed = [...changedKeys(client, pseudoLocalizeClientContent(client))];
      expect(changed.filter((key) => !TEXT_KEYS.has(key)), `blok ${block.id}`).toEqual([]);
      expect(changed.length, `blok ${block.id}: żaden tekst nie przeszedł do xx`).toBeGreaterThan(0);
    }
  });
});

describe('pseudoLocalizeClientContent (D-143, podgląd xx)', () => {
  it('teksty do czytania w xx, pola techniczne i wartości nietekstowe bez zmian; wejście nienaruszone', () => {
    const block = {
      id: 'odprawa',
      type: 'BRIEFING',
      title: 'Odprawa',
      steps: [{ text: 'Sprawdź nadawcę.', image: 'scenes/pl/odprawa.svg', kind: 'phone' }],
      choices: [{ id: 'tak', label: 'Zgłaszam', color: '#E5484D', href: 'https://example.test/x' }],
      count: 3,
      flags: ['ALWAYS'],
      code: '12 34',
    };
    const out = pseudoLocalizeClientContent(block);
    expect(out).toEqual({
      id: 'odprawa',
      type: 'BRIEFING',
      title: '[Ödpráwá ~~~]',
      steps: [{ text: '[Špráwdź ñádáwçę. ~~~]', image: 'scenes/pl/odprawa.svg', kind: 'phone' }],
      choices: [{ id: 'tak', label: '[Žgłášžám ~~~]', color: '#E5484D', href: 'https://example.test/x' }],
      count: 3,
      flags: ['ALWAYS'],
      code: '12 34',
    });
    expect(block.title).toBe('Odprawa');
  });
});
