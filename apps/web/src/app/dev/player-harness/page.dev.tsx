import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { DEFAULT_CONTENT_LOCALE, localizeContent, moduleSchema, toClientBlock, type ServerBlock, type ServerBlockOf } from '@cyberszkolo/content';
import { contentAssetBase } from '@/lib/content-assets';
import type { ContentBlock, NoteKind } from '@/lib/courses-types';
import CoursePlayer, { type CoursePlayerInitialState } from '../../courses/[courseId]/_components/CoursePlayer';
import HarnessAutoOpen from './HarnessAutoOpen';
import { DEFAULT_MODULE_SLUG, harnessModuleDir } from '../harness-module';

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
// `?module=<slug>` (B-128): dowolny moduł z packages/content/modules, domyślnie moduł 1 (harness-module.ts). Domyślny blok: dla modułu 1
// jak dotąd `biuro-anny` (wywołania layout-check bez ?block=), dla innych - pierwszy blok modułu.
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

type HarnessNote = { blockId: string; text: string; kind?: NoteKind; ref: string };

// Przesłuchanie (D-118): podważa się dowodem z notatnika - podgląd (bez backendu) wkłada do notatnika dowody z bloków modułu PRZED
// przesłuchaniem, jak po ich przejściu. Odnośnik to klucz notatki `<blok>.<element>` (w produkcji nieprzejrzysty HMAC) - layout-check
// podstawia odpowiedź /challenge i porównuje go z `refutedBy` z treści.
function evidenceNotesBefore(blocks: ServerBlock[], index: number): HarnessNote[] {
  const notes: HarnessNote[] = [];
  const push = (blockId: string, id: string, note: { text: string; kind?: NoteKind } | undefined) => {
    if (note) notes.push({ blockId, text: note.text, ...(note.kind ? { kind: note.kind } : {}), ref: `${blockId}.${id}` });
  };
  for (const block of blocks.slice(0, index)) {
    if (block.type === 'SCENE_HOTSPOTS') {
      for (const hotspot of block.hotspots.flatMap((h) => [h, ...(h.media?.kind === 'scene' ? h.media.scene.hotspots : [])])) {
        if (hotspot.evidence) push(block.id, hotspot.id, hotspot.note);
      }
    }
    if (block.type === 'CALL_RECORDING') for (const item of block.evidence ?? []) push(block.id, item.id, item.note);
    if (block.type === 'DOSSIER') for (const row of block.documents.flatMap((d) => d.rows)) if (row.evidence) push(block.id, row.id, row.note);
    if (block.type === 'DIALOGUE') for (const question of block.questions) if (question.evidence) push(block.id, question.id, question.note);
  }
  return notes;
}

export default function PlayerHarnessPage({
  searchParams,
}: {
  searchParams: { module?: string; block?: string; hotspot?: string; stripMedia?: string; completed?: string; narration?: string; noPortrait?: string };
}) {
  if (process.env.NEXT_PUBLIC_DEV_HARNESS !== '1') {
    notFound();
  }

  const harnessModule = harnessModuleDir(searchParams.module);
  if (!harnessModule) notFound();
  const rawModule: unknown = JSON.parse(fs.readFileSync(path.join(harnessModule.dir, 'module.json'), 'utf8'));
  // schemaVersion 6: harness pokazuje treść po polsku (jak API bez wyboru języka) - rozwinięcie języka przed wyborem bloku.
  const parsedModule = localizeContent(moduleSchema.parse(rawModule), DEFAULT_CONTENT_LOCALE);
  const blockId = searchParams.block ?? (harnessModule.slug === DEFAULT_MODULE_SLUG ? DEFAULT_BLOCK_ID : parsedModule.blocks[0]?.id);
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

  // `?noPortrait=1` (feat/portrait-scenes, D-098): bez wariantów pionowych (odprawa, raport zamknięcia) - layout-check sprawdza nim ścieżkę
  // zastępczą modułów bez `portrait` na telefonie (scena 16:9 w pasach, panorama raportu). Na kopii, tylko w tym procesie renderowania.
  if (searchParams.noPortrait === '1') {
    const copy = structuredClone(blockForClient) as ServerBlock & { steps?: { portrait?: unknown }[]; closing?: { portrait?: unknown } };
    for (const step of copy.steps ?? []) delete step.portrait;
    if (copy.closing) delete copy.closing.portrait;
    blockForClient = copy;
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
  // Omówienie na transkrypcji (ANNOTATED_REPLAY, D-115) czyta segmenty z bloku nagrania - podgląd dokłada ten blok PRZED omówieniem
  // (niewyświetlany; bieżący jest blok omówienia), jak w prawdziwym module.
  const sourceId = rawBlock.type === 'ANNOTATED_REPLAY' && rawBlock.source.kind === 'transcript' ? rawBlock.source.fromBlock : undefined;
  const sourceBlock = sourceId ? parsedModule.blocks.find((block) => block.id === sourceId) : undefined;
  const leading = sourceBlock
    ? [toClientBlock(sourceBlock, { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (_blockId, itemId) => itemId }) as unknown as ContentBlock]
    : [];
  const initial: CoursePlayerInitialState = {
    assignmentId: 'dev-harness',
    courseId: 'dev-harness',
    title: 'Podgląd bloku (dev harness)',
    status: completed ? 'COMPLETED' : 'IN_PROGRESS',
    startedAt: new Date(now - 14 * 60_000).toISOString(),
    completedAt: completed ? new Date(now).toISOString() : null,
    currentBlockIndex: leading.length,
    // Zadania sprawy (`?block=odprawa`, D-081) są w samym bloku BRIEFING; completeWhen wskazuje bloki spoza podglądu (jeden
    // blok), więc nic się tu nie odhacza.
    contentBlocks: [...leading, contentBlock],
    progress:
      rawBlock.type === 'INTERROGATION'
        ? { v: 2, blocks: {}, notes: evidenceNotesBefore(parsedModule.blocks, parsedModule.blocks.indexOf(rawBlock)) }
        : null,
    score: null,
    // Tryb prosty (D-132): z modułu, jak z wersji kursu w /start. Ocena kliknięć (/check) - layout-check podstawia odpowiedź z treści.
    simpleMode: parsedModule.simpleMode === true,
  };

  // Bez CONTENT_BASE_URL obrazy idą z lokalnych assets/ modułu (trasa dev /dev/module-assets, D-084) - także te jeszcze
  // nieopublikowane w magazynie; z CONTENT_BASE_URL - z magazynu, jak na produkcji. Slug modułu jest pierwszym segmentem trasy.
  const contentBase = process.env.CONTENT_BASE_URL
    ? contentAssetBase(process.env.CONTENT_BASE_URL, process.env.NODE_ENV === 'development')
    : `/dev/module-assets/${harnessModule.slug}`;

  return (
    <div className="h-dvh overflow-hidden bg-paper">
      {/* `?narration=1` (fix/mobile-player-bar): lektor włączony - layout-check podstawia nagranie (page.route) i mierzy przycisk
          odtwarzania i linijkę napisów w dolnym pasku. Domyślnie wyłączony, jak dotąd (bez prób ładowania audio). */}
      <CoursePlayer courseId="dev-harness" initial={initial} contentBase={contentBase} narrationEnabled={searchParams.narration === '1'} persistExploration={false} />
      {clickPath && <HarnessAutoOpen path={clickPath} />}
    </div>
  );
}
