import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * Next.js wymaga, żeby segmenty dynamiczne na TYM SAMYM poziomie ścieżki miały tę samą nazwę
 * parametru: `/api/users/[id]/route.ts` obok `/api/users/[userId]/avatar/image/route.ts` to błąd
 * „You cannot use different slug names for the same dynamic path”.
 *
 * Problem w tym, że wywala się dopiero `next build` - ani `next dev`, ani lint, ani typecheck, ani
 * testy tego nie łapią. Raz już przez to padł build obrazu web PO merge'u do `main` (PR #25).
 * Ten test jest tanią barierą: biegnie w każdym przebiegu testów, czyli także w sprawdzeniach PR.
 */
const APP_DIR = join(__dirname);

function dynamicSegmentNames(dir: string): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();

  function walk(current: string, routePath: string) {
    const entries = readdirSync(current, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const dynamic = entries.map((entry) => entry.name).filter((name) => name.startsWith('[') && name.endsWith(']'));
    if (dynamic.length > 1) {
      // Grupy tras (nawiasy okrągłe) i segmenty catch-all mają inne zasady, ale zwykłe `[x]`
      // rodzeństwo zawsze musi mieć jedną nazwę.
      conflicts.set(routePath || '/', dynamic);
    }
    for (const entry of entries) {
      walk(join(current, entry.name), `${routePath}/${entry.name}`);
    }
  }

  walk(dir, '');
  return conflicts;
}

describe('trasy Next.js', () => {
  it('na jednym poziomie ścieżki nie ma dwóch różnych nazw parametru dynamicznego', () => {
    // Pusta mapa = brak konfliktów; przy błędzie komunikat pokazuje ścieżkę i kolidujące nazwy.
    expect(Object.fromEntries(dynamicSegmentNames(APP_DIR))).toEqual({});
  });
});
