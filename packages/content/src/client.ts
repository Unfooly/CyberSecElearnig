import { BlockType, BLOCK_TYPES, FIELD_CLASSIFICATION, FieldClassification } from './blocks';

// Tasowanie determinowane sekretem SERWERA. Seed MUSI pochodzić z HMAC z kluczem serwera (nie z samych publicznych
// identyfikatorów): przy jawnym seedzie klient odtworzyłby permutację i odwrócił ją, odzyskując kolejność z JSON-a (= odpowiedź).
export type ShuffleSeed = readonly [number, number, number, number];

export interface ClientContext {
  /** Seed tasowania elementów danego bloku (patrz komentarz wyżej). */
  shuffleSeed: (blockId: string) => ShuffleSeed;
  /**
   * Nieprzejrzysty identyfikator elementu (pochodna HMAC z assignmentId, versionId, blockId, itemId). Klient dostaje WYŁĄCZNIE takie
   * id w blokach ocenianych po id (ORDERING, EMAIL_ANALYSIS) i odsyła je w odpowiedzi; serwer mapuje je z powrotem. Bez tego nazwy
   * w rodzaju "krok1..krok3" albo "poprawne-1" zdradzałyby klucz mimo tasowania. Id jest inny w każdym przypisaniu.
   */
  opaqueId: (blockId: string, itemId: string) => string;
}

// sfc32 - mały, szybki PRNG; wystarcza do tasowania (nie do kryptografii - kryptografia jest w HMAC seeda).
function sfc32(seed: ShuffleSeed): () => number {
  let [a, b, c, d] = seed.map((n) => n >>> 0);
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Rozgrzewka (zalecana dla sfc32): bez niej bliskie seedy dawałyby niemal identyczny początek ciągu.
  for (let i = 0; i < 20; i += 1) next();
  return next;
}

/**
 * Fisher-Yates z zadanym seedem. CELOWO bez reguły "nigdy kolejność wejściowa": taka reguła zawęża przestrzeń permutacji (przy 2
 * elementach wynik byłby zawsze odwrotnością poprawnej kolejności) i sama zdradza odpowiedź. Układ początkowy bywa więc poprawny z
 * prawdopodobieństwem 1/n!. Seed jest stały dla przypisania, więc odświeżenie strony nie daje nowej permutacji.
 */
export function seededShuffle<T>(items: readonly T[], seed: ShuffleSeed): T[] {
  const result = [...items];
  const random = sfc32(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Wybiera z wartości WYŁĄCZNIE wskazane ścieżki (`a.b`, `a[].b`, `a[]` dla tablicy prymitywów). Klucze wynikowego obiektu
 * pochodzą z listy ścieżek (zaufanej), nigdy z danych - nie da się wstrzyknąć `__proto__` z treści.
 */
export function pickByPaths(value: unknown, paths: string[]): unknown {
  if (paths.includes('')) return structuredCloneJson(value);
  if (Array.isArray(value)) {
    const sub = paths.filter((p) => p.startsWith('[]')).map((p) => p.slice(2).replace(/^\./, ''));
    return sub.length === 0 ? [] : value.map((item) => pickByPaths(item, sub));
  }
  if (isPlainObject(value)) {
    const byKey = new Map<string, string[]>();
    for (const path of paths) {
      const match = /^([A-Za-z0-9_]+)(.*)$/.exec(path);
      if (!match) continue;
      const rest = match[2].replace(/^\./, '');
      const list = byKey.get(match[1]) ?? [];
      list.push(rest);
      byKey.set(match[1], list);
    }
    const out: Record<string, unknown> = {};
    for (const [key, rests] of byKey) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
        out[key] = pickByPaths(value[key], rests);
      }
    }
    return out;
  }
  return undefined;
}

function structuredCloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export type ClientBlock = { id: string; type: string; [key: string]: unknown };

/** Podmienia id elementów na nieprzejrzyste i tasuje kolejność (seed serwera). */
function opaqueAndShuffle(list: unknown, blockId: string, context: ClientContext): unknown[] {
  const items = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  const opaque = items.map((item) => ({ ...item, id: context.opaqueId(blockId, String(item.id)) }));
  return seededShuffle(opaque, context.shuffleSeed(blockId));
}

export function isKnownBlockType(type: unknown): type is BlockType {
  return typeof type === 'string' && (BLOCK_TYPES as string[]).includes(type);
}

/**
 * Jedyna droga treści bloku do przeglądarki. Biała lista pól (FIELD_CLASSIFICATION), potem transformacje zależne od
 * typu: tasowanie kryteriów/elementów (sekretem serwera) i liczba podpowiedzi zamiast ich treści. Nieznany typ dostaje
 * tylko `id` i `type` (nigdy dane, których nie umiemy sklasyfikować).
 */
export function toClientBlock(
  block: Record<string, unknown>,
  context: ClientContext,
  // Podmieniana WYŁĄCZNIE w testach mutacyjnych (classification.spec.ts); produkcyjnie zawsze FIELD_CLASSIFICATION.
  classification: Record<BlockType, FieldClassification> = FIELD_CLASSIFICATION,
): ClientBlock {
  const id = typeof block.id === 'string' ? block.id : '';
  const type = typeof block.type === 'string' ? block.type : 'UNKNOWN';
  if (!isKnownBlockType(type)) return { id, type };

  const picked = pickByPaths(block, classification[type].client) as Record<string, unknown>;
  const result: ClientBlock = { ...picked, id, type };

  switch (type) {
    case 'EMAIL_ANALYSIS': {
      result.criteria = opaqueAndShuffle(result.criteria, id, context);
      break;
    }
    case 'ORDERING': {
      result.items = opaqueAndShuffle(result.items, id, context);
      break;
    }
    case 'TEXT_INPUT_GUIDED': {
      const hints = Array.isArray(block.hints) ? block.hints.length : 0;
      result.hintCount = hints;
      break;
    }
    default:
      break;
  }
  return result;
}
