import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModule } from './node';

// Okładki ekranu startu i końca oraz miniatury modułów (D-163, D-170, D-173): każdy moduł ma komplet opublikowanych grafik WebP
// (klucze z potoku --assets: assets/<slug>/images/<nazwa>.<hash8>.webp). Bez okładki ekran startu spada do ciemnego tła - tu
// pilnujemy, żeby żaden moduł nie zgubił jej po cichu (layout-check nie jest częścią CI, B-101).
const MODULES = ['wyludzone-haslo', 'glos-z-helpdesku', 'lancuszek', 'na-skroty', 'najlatwiejsze-drzwi'];

describe('okładki i miniatury modułów (D-173)', () => {
  it.each(MODULES)('%s: start, koniec (poziomo i pionowo) i miniatura - opublikowane WebP', (slug) => {
    const parsed = parseModule(JSON.parse(readFileSync(join(__dirname, '..', 'modules', slug, 'module.json'), 'utf8')));
    const key = new RegExp(`^assets/${slug}/images/[a-z-]+\\.[0-9a-f]{8}\\.webp$`);
    const cover = parsed.cover as Record<string, unknown> | undefined;
    for (const field of ['start', 'end', 'startPortrait', 'endPortrait']) expect(cover?.[field]).toMatch(key);
    expect(parsed.thumbnail).toMatch(key);
  });
});
