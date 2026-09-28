import { P } from './palette.js';
import { PROPS } from './props.js';
import { SCREEN_FRAME_STAND } from './props-odprawa.js';
import type { SceneSpec } from './types.js';

// Czyste przekształcenia scen dla grafik otwieranych kliknięciem (D-101) - używane przez crop-zooms.ts i wrap-in-monitor.ts i testowane
// w scene-tools.test.ts. Zmieniają wyłącznie tło, kadr i przesunięcia; treść elementów zostaje nietknięta; drugi przebieg nic nie zmienia.

/**
 * Elementy wystające ponad pudełko klocka (w jednostkach klocka): para z kubka, taśma karteczki. Ręczna tabela - nowy klocek, który
 * rysuje coś nad swoim pudełkiem (y < 0), trzeba tu dopisać, inaczej crop utnie ten fragment.
 */
export const OVERFLOW_TOP: Record<string, number> = { mug: 34, stickyNote: 8 };
const CROP_PAD = 36;
const SHADOW = 16;

/** Przezroczyste tło + ciasny kadr wokół JEDYNEGO elementu sceny. Scena z inną liczbą elementów to błąd. */
export function cropZoom(spec: SceneSpec): SceneSpec {
  if (spec.items.length !== 1) throw new Error(`crop-zooms: scena ma ${spec.items.length} elementów (oczekiwany dokładnie 1)`);
  const item = spec.items[0];
  const fn = PROPS[item.prop];
  if (!fn) throw new Error(`crop-zooms: nieznany klocek "${item.prop}"`);
  const out = fn(item.params ?? {});
  const s = item.scale ?? 1;
  const top = CROP_PAD + (OVERFLOW_TOP[item.prop] ?? 0) * s;
  return {
    ...spec,
    width: Math.round(out.w * s + CROP_PAD * 2 + SHADOW),
    height: Math.round(out.h * s + top + CROP_PAD + SHADOW),
    background: { flat: true, wall: 'none' },
    items: [{ ...item, x: CROP_PAD, y: Math.round(top) }],
  };
}

const WRAP_PAD = 30;
const BEZEL = 28;
export const FRAME_ID = 'ramka-ekranu';

/**
 * Ekran komputera w ramce monitora (`screenFrame`): tapeta = dotychczasowy kolor tła sceny, elementy przesunięte o ramkę, tło wokół
 * przezroczyste. Scena już owinięta (element FRAME_ID) wraca bez zmian; scena bez koloru tła (wall 'none') to błąd - nie ma tapety.
 */
export function wrapInMonitor(spec: SceneSpec): SceneSpec {
  if (spec.items.some((item) => item.id === FRAME_ID)) return spec;
  const wallpaper = spec.background?.wall ?? P.wall;
  if (wallpaper === 'none') throw new Error('wrap-in-monitor: scena bez koloru tła (wall "none") - nie ma z czego zrobić tapety ekranu');
  const sw = spec.width ?? 1600, sh = spec.height ?? 1000;
  const off = WRAP_PAD + BEZEL;
  return {
    ...spec,
    width: sw + 2 * (WRAP_PAD + BEZEL) + SHADOW,
    height: sh + 2 * BEZEL + SCREEN_FRAME_STAND + 2 * WRAP_PAD + SHADOW,
    background: { flat: true, wall: 'none' },
    items: [
      { id: FRAME_ID, prop: 'screenFrame', x: WRAP_PAD, y: WRAP_PAD, params: { sw, sh, wallpaper, bezel: BEZEL } },
      ...spec.items.map((item) => ({ ...item, x: item.x + off, y: item.y + off })),
    ],
  };
}
