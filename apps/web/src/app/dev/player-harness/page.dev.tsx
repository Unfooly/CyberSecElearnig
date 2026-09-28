import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { moduleSchema, toClientBlock, type ServerBlock, type ServerBlockOf } from '@cyberszkolo/content';
import { contentAssetBase } from '@/lib/content-assets';
import type { ContentBlock } from '@/lib/courses-types';
import CoursePlayer, { type CoursePlayerInitialState } from '../../courses/[courseId]/_components/CoursePlayer';
import HarnessAutoOpen from './HarnessAutoOpen';

// Podgląd układu bloku w PRAWDZIWYM PlayerStage, bez backendu (bez /courses/:id/start, bez logowania) - treść
// wprost z packages/content (module.json), obrazy z CONTENT_BASE_URL jak na produkcji (bez niej - z lokalnych assets/ modułu,
// trasa dev /dev/module-assets). Wyłącznie do
// scripts/layout-check.mjs (Playwright) i ręcznego podglądu przy pracy nad układem bloku - NIE jest to część
// produktu. Dostępne TYLKO gdy NEXT_PUBLIC_DEV_HARNESS=1 (notFound() w każdym innym przypadku, także na produkcji -
// zmienna nie jest ustawiona tam z definicji). Trasa NIE jest na liście PROTECTED_ROUTES (middleware.ts), więc i tak
// nie wymaga logowania - ten notFound() jest jedynym, ale wystarczającym zamknięciem: bez flagi trasa nie istnieje.
// `?block=<id>` (fix/dialogue-sticky-questions) wybiera DOWOLNY blok modułu PO ID (nie tylko SCENE_HOTSPOTS jak
// pierwotnie) - domyślnie DEFAULT_BLOCK_ID, żeby dotychczasowe wywołania scripts/layout-check.mjs (bez ?block=)
// zostały bez zmian. `?hotspot=`/`?stripMedia=` (drilling HarnessAutoOpen, patrz niżej) mają sens WYŁĄCZNIE dla
// SCENE_HOTSPOTS - dla innych typów bloku (np. DIALOGUE) są po prostu ignorowane.
const MODULE_SLUG = 'wyludzone-haslo';
const DEFAULT_BLOCK_ID = 'biuro-anny';

type SceneHotspotsServerBlock = ServerBlockOf<'SCENE_HOTSPOTS'>;
type ServerHotspot = SceneHotspotsServerBlock['hotspots'][number];

// Szuka hotspotu o `targetId` w tablicy hotspotów (dowolny poziom - zewnętrzny albo wewnątrz media.kind:'scene',
// SceneHotspotsBlock.tsx wspiera dokładnie 2 poziomy) i zwraca ścieżkę id-ów od zewnętrznego do znalezionego -
// HarnessAutoOpen klika w te testidy po kolei, żeby otworzyć kartę zagnieżdżonego hotspotu (np. "outlook").
function findHotspotPath(hotspots: ServerHotspot[], targetId: string, prefix: string[] = []): string[] | null {
  for (const hotspot of hotspots) {
    const here = [...prefix, hotspot.id];
    if (hotspot.id === targetId) return here;
    if (hotspot.media?.kind === 'scene') {
      const found = findHotspotPath(hotspot.media.scene.hotspots, targetId, here);
      if (found) return found;
    }
  }
  return null;
}

export default function PlayerHarnessPage({
  searchParams,
}: {
  searchParams: { block?: string; hotspot?: string; stripMedia?: string; completed?: string; narration?: string };
}) {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') {
    notFound();
  }

  const modulePath = path.join(process.cwd(), '..', '..', 'packages', 'content', 'modules', MODULE_SLUG, 'module.json');
  const rawModule: unknown = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  const parsedModule = moduleSchema.parse(rawModule);
  const blockId = searchParams.block ?? DEFAULT_BLOCK_ID;
  const rawBlock: ServerBlock | undefined = parsedModule.blocks.find((block) => block.id === blockId);
  if (!rawBlock) notFound();

  // Drilling (HarnessAutoOpen) i ?stripMedia= mają sens WYŁĄCZNIE dla SCENE_HOTSPOTS - inne typy bloku (np.
  // DIALOGUE) ignorują oba parametry, blockForClient zostaje wtedy po prostu rawBlock.
  const hotspotParam = searchParams.hotspot;
  const stripMedia = searchParams.stripMedia === '1';
  let clickPath: string[] | null = null;
  let blockForClient: ServerBlock = rawBlock;
  if (rawBlock.type === 'SCENE_HOTSPOTS' && hotspotParam) {
    clickPath = findHotspotPath(rawBlock.hotspots, hotspotParam);
    // ?stripMedia=1: treść modułu 1 nie ma dziś przedmiotu bez mediów (drzwi nie otwierają zbliżenia) - scripts/layout-check.mjs i
    // tak sprawdza gałąź "opis zamiast grafiki" w zbliżeniu (D-086). Zamiast wymyślać syntetyczną treść, bierzemy PRAWDZIWY hotspot z
    // `?hotspot=` i usuwamy mu pole `media` (na kopii, TYLKO w tym procesie renderowania) - toClientBlock i tak
    // przechodzi przez tę samą białą listę pól co produkcja, ten krok dzieje się wcześniej, na surowych danych.
    if (stripMedia) {
      blockForClient = { ...rawBlock, hotspots: rawBlock.hotspots.map((h) => (h.id === hotspotParam ? { ...h, media: undefined } : h)) };
    }
  }

  // Ani SCENE_HOTSPOTS, ani DIALOGUE, ani BRIEFING nie używają shuffleSeed/opaqueId (tylko EMAIL_ANALYSIS/ORDERING/
  // TEXT_INPUT_GUIDED w client.ts) - wartości poniżej nigdy nie trafiają do wyniku dla tych typów bloku, są tu
  // wyłącznie, żeby zaspokoić sygnaturę wspólną dla WSZYSTKICH typów.
  const contentBlock = toClientBlock(blockForClient, {
    shuffleSeed: () => [1, 2, 3, 4],
    opaqueId: (_blockId, itemId) => itemId,
  }) as unknown as ContentBlock;

  // `?completed=1` (feat/case-closed, D-089): przypisanie już ukończone - ekran zamknięcia sprawy w stanie końcowym (powrót do
  // ukończonego kursu). Czas sprawy (startedAt -> completedAt) stały: 14 min.
  const completed = searchParams.completed === '1';
  const now = Date.now();
  const initial: CoursePlayerInitialState = {
    assignmentId: 'dev-harness',
    courseId: 'dev-harness',
    title: 'Podgląd bloku (dev harness)',
    status: completed ? 'COMPLETED' : 'IN_PROGRESS',
    startedAt: new Date(now - 14 * 60_000).toISOString(),
    completedAt: completed ? new Date(now).toISOString() : null,
    currentBlockIndex: 0,
    // Zadania sprawy (`?block=odprawa`, D-081) są w samym bloku BRIEFING; completeWhen wskazuje bloki spoza podglądu (jeden
    // blok), więc nic się tu nie odhacza.
    contentBlocks: [contentBlock],
    progress: null,
    score: null,
  };

  // Bez CONTENT_BASE_URL obrazy idą z lokalnych assets/ modułu (trasa dev /dev/module-assets, D-084) - także te jeszcze
  // nieopublikowane w magazynie; z CONTENT_BASE_URL - z magazynu, jak na produkcji. Trasa zna tylko MODULE_SLUG (jak ta
  // strona) - harness z innym modułem wymaga zmiany w obu miejscach.
  const contentBase = process.env.CONTENT_BASE_URL
    ? contentAssetBase(process.env.CONTENT_BASE_URL, process.env.NODE_ENV === 'development')
    : '/dev/module-assets';

  return (
    <div className="h-dvh overflow-hidden bg-paper">
      {/* `?narration=1` (fix/mobile-player-bar): lektor włączony - layout-check podstawia nagranie (page.route) i mierzy przycisk
          odtwarzania i linijkę napisów w dolnym pasku. Domyślnie wyłączony, jak dotąd (bez prób ładowania audio). */}
      <CoursePlayer courseId="dev-harness" initial={initial} contentBase={contentBase} narrationEnabled={searchParams.narration === '1'} />
      {clickPath && <HarnessAutoOpen path={clickPath} />}
    </div>
  );
}
