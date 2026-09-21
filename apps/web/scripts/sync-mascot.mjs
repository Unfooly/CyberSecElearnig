// Kopiuje pliki SVG maskotki z packages/content/mascot do apps/web/public/mascot (bundlowane z web, serwowane z własnej domeny: to element
// UI, nie treść modułu, więc NIE z CONTENT_BASE_URL). Uruchamiane automatycznie przed `next dev` i `next build` (predev/prebuild).
// Kopiuje wyłącznie pięć plików z ustaloną nazwą (nigdy archiwum ani podglądu z tego katalogu). Brak pliku nie przerywa buildu:
// komponent <Mascot> pokazuje wtedy placeholder (fallback przy błędzie ładowania).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSES = ['greeting', 'thinking', 'pointing', 'cheer', 'warning'];
const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'packages', 'content', 'mascot');
const target = join(here, '..', 'public', 'mascot');

const wanted = new Set(POSES.map((pose) => `fooli-${pose}.svg`));

mkdirSync(target, { recursive: true });
// Katalog docelowy jest generowany (w .gitignore): usuwamy pliki spoza listy, żeby nic obcego nie trafiło do obrazu.
for (const file of readdirSync(target)) {
  if (!wanted.has(file)) rmSync(join(target, file), { recursive: true, force: true });
}

const missing = [];
for (const file of wanted) {
  const from = join(source, file);
  if (existsSync(from)) copyFileSync(from, join(target, file));
  else missing.push(file);
}

if (missing.length > 0) {
  console.warn(`[sync-mascot] Brak plików maskotki w packages/content/mascot: ${missing.join(', ')} (w UI będzie placeholder).`);
} else {
  console.log(`[sync-mascot] Skopiowano ${wanted.size} plików maskotki do apps/web/public/mascot.`);
}
