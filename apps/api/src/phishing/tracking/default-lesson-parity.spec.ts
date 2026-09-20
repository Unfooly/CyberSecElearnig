import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LESSON_HTML } from './tracking.service';

// Lekcja domyślna istnieje w dwóch kopiach: API (odpowiedź dla nieznanego tokenu) i web (BFF dla tokenu o złym formacie).
// Rozjazd dałby wyrocznię (inna treść dla złego formatu i nieznanego tokenu), więc pilnujemy zgodności tekstu.
describe('DEFAULT_LESSON_HTML: parzystość API i web', () => {
  it('treść w apps/web/src/lib/tracking.ts jest identyczna z apps/api', () => {
    const source = readFileSync(join(__dirname, '../../../../web/src/lib/tracking.ts'), 'utf8');
    const declaration = /export const DEFAULT_LESSON_HTML =([\s\S]*?);\s*$/m.exec(source)?.[1] ?? '';
    const webValue = [...declaration.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]).join('');

    expect(webValue).not.toBe('');
    expect(webValue).toBe(DEFAULT_LESSON_HTML);
  });
});
