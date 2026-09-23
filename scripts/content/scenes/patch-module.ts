import type { Hotspot } from './types.js';

/** Hotspot tak jak wygląda w module.json (packages/content/src/blocks.ts): "width"/"height", NIE "w"/"h" jak Hotspot (compose.ts). */
export interface ModuleHotspot {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  media?: { kind?: string; scene?: { hotspots?: ModuleHotspot[] } };
  [key: string]: unknown;
}

export interface ModuleBlock {
  id: string;
  type: string;
  hotspots?: ModuleHotspot[];
  [key: string]: unknown;
}

export interface ContentModuleLike {
  blocks: ModuleBlock[];
}

/**
 * Wybiera tablicę hotspotów do podmiany współrzędnych: hotspoty najwyższego poziomu bloku `blockId`, albo (z `nestedId`)
 * hotspoty WEWNĄTRZ zagnieżdżonej sceny (media.kind: "scene") hotspotu `nestedId` tego bloku (B-086/D-071).
 */
export function resolveTargetHotspots(mod: ContentModuleLike, blockId: string, nestedId?: string): ModuleHotspot[] {
  const block = mod.blocks.find((b) => b.id === blockId);
  if (!block || block.type !== 'SCENE_HOTSPOTS' || !block.hotspots) throw new Error(`Blok ${blockId} nie istnieje albo nie jest SCENE_HOTSPOTS`);
  if (!nestedId) return block.hotspots;
  const outer = block.hotspots.find((h) => h.id === nestedId);
  if (!outer || outer.media?.kind !== 'scene' || !outer.media.scene?.hotspots) {
    throw new Error(`Hotspot "${nestedId}" nie istnieje w bloku ${blockId} albo nie ma media.kind:"scene"`);
  }
  return outer.media.scene.hotspots;
}

/**
 * Podmienia x/y/width/height (PO ID) na hotspotach `targetHotspots` z wyliczonych `computed` (wynik composeScene).
 * module.json (packages/content/src/blocks.ts) nazywa te pola "width"/"height", NIE "w"/"h" jak `Hotspot` (types.ts) -
 * dokładnie to pomylenie było realnym bugiem (--module/--block nigdy by nie zadziałało: pisało nieznane klucze "w"/"h",
 * które strict() schema odrzuca, i nigdy nie ustawiało width/height). Zwraca liczbę podmienionych hotspotów.
 */
export function patchHotspotCoords(targetHotspots: ModuleHotspot[], computed: readonly Hotspot[]): number {
  const byId = new Map(computed.map((h) => [h.id, h]));
  let patched = 0;
  for (const hs of targetHotspots) {
    const h = byId.get(hs.id);
    if (!h) throw new Error(`Hotspot "${hs.id}" z module.json nie istnieje w scenie`);
    Object.assign(hs, { x: h.x, y: h.y, width: h.w, height: h.h });
    patched++;
  }
  return patched;
}
