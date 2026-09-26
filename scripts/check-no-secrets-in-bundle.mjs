// Sprawdza, że sekretne pola treści (klucz odpowiedzi, wyjaśnienia, reactions.result, podpowiedzi) NIE trafiają do
// KLIENCKIEGO bundla Next.js (apps/web/.next/static/) - silnik szkoleń, niezmiennik nr 1 (CLAUDE.md): "Klucz
// odpowiedzi nigdy nie trafia do klienta". Powód tego testu: apps/web/src/app/dev/player-harness/page.tsx
// (fix/hotspot-card-fit) wczytuje CAŁY packages/content/modules/wyludzone-haslo/module.json po stronie serwera,
// zanim wybierze i przefiltruje przez toClientBlock JEDEN blok (SCENE_HOTSPOTS "biuro-anny") - ten test potwierdza,
// że NIEUŻYWANA reszta modułu (sekrety WSZYSTKICH INNYCH bloków: EMAIL_ANALYSIS.criteria[].explanation,
// reactions.result, TEXT_INPUT_GUIDED.hints/answer) nigdy nie wycieka do przeglądarki - ani gdy
// NEXT_PUBLIC_DEV_HARNESS jest ustawione (harness aktywny), ani gdy nie jest (harness zwraca notFound(), ale
// zmienna NEXT_PUBLIC_* i tak jest wpisana w bundle klienta w czasie builda, więc oba warianty warto sprawdzić
// osobno - CLAUDE.md reguła 12/B-101).
//
// Użycie: node scripts/check-no-secrets-in-bundle.mjs
// Wymaga WCZEŚNIEJ zbudowanego apps/web/.next (`npm run build --workspace=apps/web`) - ten skrypt sam NIE builduje,
// żeby dało się go uruchomić dwukrotnie (raz bez, raz z NEXT_PUBLIC_DEV_HARNESS=1 na buildzie) bez wymuszania
// konkretnej kolejności/podwójnego builda w jednym wywołaniu.
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const STATIC_DIR = join(process.cwd(), 'apps', 'web', '.next', 'static');
const TEXT_EXTENSIONS = new Set(['.js', '.css', '.json', '.map', '.txt']);

// Trzy charakterystyczne, sekretne ciągi z packages/content/modules/wyludzone-haslo/module.json - po jednym z
// TRZECH RÓŻNYCH bloków/kategorii sekretu (nie tylko ten sam typ pola), żeby test nie przeoczył systemowej luki
// dotyczącej tylko jednej kategorii:
const SECRET_STRINGS = [
  // EMAIL_ANALYSIS (ten-mail): criteria[].explanation kryterium "odliczanie" - ujawnia próg oceny przed odpowiedzią.
  'Prawdziwy bank nie odlicza sekund do blokady konta',
  // ORDERING (rekonstrukcja): reactions.result[].text - próg/tekst reakcji na WYNIK bloku, zdradzałby ocenę z góry.
  'łańcuch dało się przerwać w trzech miejscach',
  // TEXT_INPUT_GUIDED (ostatnie-pytanie): hints[].text - treść podpowiedzi (do klienta idzie tylko liczba, hintCount).
  'Spójrz na to, co jest po @ w adresie nadawcy',
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(full);
  }
  return files;
}

async function main() {
  try {
    await stat(STATIC_DIR);
  } catch {
    console.error(`Brak ${STATIC_DIR} - uruchom najpierw: npm run build --workspace=apps/web`);
    process.exitCode = 1;
    return;
  }

  const files = await walk(STATIC_DIR);
  let hits = 0;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const secret of SECRET_STRINGS) {
      if (content.includes(secret)) {
        hits += 1;
        console.error(`WYCIEK: "${secret}" znaleziony w ${file}`);
      }
    }
  }

  console.log(`\nPrzeszukano ${files.length} plików tekstowych w ${STATIC_DIR}.`);
  console.log(`Trafień: ${hits} (oczekiwane: 0).`);
  if (hits > 0) {
    console.error('\nSekret z treści kursu trafił do klienckiego bundla - napraw przed mergem (CLAUDE.md, "Silnik szkoleń").');
    process.exitCode = 1;
  }
}

await main();
