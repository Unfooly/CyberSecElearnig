// Zrzuty ekranu pełnego przejścia modułu w dwóch rozdzielczościach (desktop 1440x900, mobile 390x844) - jednorazowe narzędzie
// operatorskie do raportów i opisów PR, NIE część CI. Zrzuty trafiają do `docs/brand/screens/<slug>/` (poza gitem - `.gitignore`).
//
// Kroki przejścia NIE są tu powielane (B-164): skrypt uruchamia ręczny e2e danego modułu (`scripts/e2e-module-0N.mjs`) z E2E_SHOTS_DIR -
// ten sam przebieg z asercjami robi zrzut każdego kluczowego momentu. Zmiana treści modułu = poprawka w jednym miejscu.
//
// Użycie z katalogu repo (jak e2e modułu - zbudowane packages/content i apps/api, baza lokalna, grafiki z R2):
//   CONTENT_BASE_URL=https://content.unfooly.com npx dotenv -e .env -- node scripts/screenshot-module.mjs [slug]
// (domyślnie `wyludzone-haslo` - moduł 1).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Moduły, których skrypt e2e robi zrzuty (E2E_SHOTS_DIR). Moduł 2 (`glos-z-helpdesku`) jeszcze ich nie ma.
const SCRIPTS = {
  'wyludzone-haslo': 'e2e-module-01.mjs',
  lancuszek: 'e2e-module-03.mjs',
  'na-skroty': 'e2e-module-04.mjs',
};
const VIEWPORTS = ['1440x900', '390x844'];

const slug = process.argv[2] ?? 'wyludzone-haslo';
const script = SCRIPTS[slug];
if (!script) {
  console.error(`Brak skryptu zrzutów dla modułu "${slug}". Obsługiwane: ${Object.keys(SCRIPTS).join(', ')}.`);
  process.exit(1);
}
const outDir = join(process.cwd(), 'docs', 'brand', 'screens', slug);
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const viewport of VIEWPORTS) {
  console.log(`\n--- przebieg: ${slug} ${viewport} -> ${outDir} ---`);
  const run = spawnSync(process.execPath, [join('scripts', script)], {
    env: { ...process.env, E2E_VIEWPORT: viewport, E2E_SHOTS_DIR: outDir },
    stdio: 'inherit',
  });
  if (run.status !== 0) failed = true;
}
console.log(failed ? '\nBŁĄD: co najmniej jeden przebieg nieudany (zrzuty niepełne)' : '\nWSZYSTKIE ZRZUTY OK');
process.exitCode = failed ? 1 : 0;
