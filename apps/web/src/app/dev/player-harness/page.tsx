import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { moduleSchema, toClientBlock, type ServerBlockOf } from '@cyberszkolo/content';
import { contentAssetBase } from '@/lib/content-assets';
import type { ContentBlock } from '@/lib/courses-types';
import CoursePlayer, { type CoursePlayerInitialState } from '../../courses/[courseId]/_components/CoursePlayer';
import HarnessAutoOpen from './HarnessAutoOpen';

// Podgląd układu karty hotspotu w PRAWDZIWYM PlayerStage, bez backendu (bez /courses/:id/start, bez logowania) -
// treść wprost z packages/content (module.json), obrazy z CONTENT_BASE_URL jak na produkcji. Wyłącznie do
// scripts/layout-check.mjs (Playwright) i ręcznego podglądu przy pracy nad układem karty - NIE jest to część
// produktu. Dostępne TYLKO gdy NEXT_PUBLIC_DEV_HARNESS=1 (notFound() w każdym innym przypadku, także na produkcji -
// zmienna nie jest ustawiona tam z definicji). Trasa NIE jest na liście PROTECTED_ROUTES (middleware.ts), więc i tak
// nie wymaga logowania - ten notFound() jest jedynym, ale wystarczającym zamknięciem: bez flagi trasa nie istnieje.
const MODULE_SLUG = 'wyludzone-haslo';
const SCENE_BLOCK_ID = 'biuro-anny';

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

export default function PlayerHarnessPage({ searchParams }: { searchParams: { hotspot?: string } }) {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') {
    notFound();
  }

  const modulePath = path.join(process.cwd(), '..', '..', 'packages', 'content', 'modules', MODULE_SLUG, 'module.json');
  const rawModule: unknown = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  const parsedModule = moduleSchema.parse(rawModule);
  const rawBlock = parsedModule.blocks.find(
    (block): block is SceneHotspotsServerBlock => block.id === SCENE_BLOCK_ID && block.type === 'SCENE_HOTSPOTS',
  );
  if (!rawBlock) notFound();

  // SCENE_HOTSPOTS nie używa shuffleSeed/opaqueId (tylko EMAIL_ANALYSIS/ORDERING/TEXT_INPUT_GUIDED w client.ts) -
  // wartości poniżej nigdy nie trafiają do wyniku dla tego typu bloku, są tu wyłącznie, żeby zaspokoić sygnaturę.
  const contentBlock = toClientBlock(rawBlock, {
    shuffleSeed: () => [1, 2, 3, 4],
    opaqueId: (_blockId, itemId) => itemId,
  }) as unknown as ContentBlock;

  const hotspotParam = searchParams.hotspot;
  const clickPath = hotspotParam ? findHotspotPath(rawBlock.hotspots, hotspotParam) : null;

  const initial: CoursePlayerInitialState = {
    assignmentId: 'dev-harness',
    courseId: 'dev-harness',
    title: 'Podgląd karty hotspotu (dev harness)',
    status: 'IN_PROGRESS',
    currentBlockIndex: 0,
    contentBlocks: [contentBlock],
    progress: null,
    score: null,
  };

  const contentBase = contentAssetBase(process.env.CONTENT_BASE_URL, process.env.NODE_ENV === 'development');

  return (
    <div className="h-dvh overflow-hidden bg-paper">
      <CoursePlayer courseId="dev-harness" initial={initial} contentBase={contentBase} narrationEnabled={false} />
      {clickPath && <HarnessAutoOpen path={clickPath} />}
    </div>
  );
}
