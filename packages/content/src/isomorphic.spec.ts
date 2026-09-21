import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Część izomorficzna pakietu (index.ts) jest importowana przez apps/web (bundle przeglądarki): nie może wciągać modułów Node ani
// natywnego re2 (regex.ts, semantics.ts, node.ts). Test czyta źródła zamiast polegać na buildzie webu, który dopiero wywali się w CI.
describe('część izomorficzna pakietu nie zależy od modułów Node', () => {
  const isomorphicFiles = ['index', 'common', 'blocks', 'module', 'client', 'introspect'];
  const forbidden = [/from 're2'/, /from 'node:/, /from 'crypto'/, /from 'fs'/, /from '\.\/regex'/, /from '\.\/semantics'/, /from '\.\/node'/, /from '\.\/fixtures'/];

  it.each(isomorphicFiles)('%s.ts', (file) => {
    const source = readFileSync(join(__dirname, `${file}.ts`), 'utf8');
    for (const pattern of forbidden) expect(source).not.toMatch(pattern);
  });
});
