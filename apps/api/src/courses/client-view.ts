import { createHmac, hkdfSync } from 'node:crypto';
import { ClientContext, ShuffleSeed } from '@cyberszkolo/content';
import { ProgressV2 } from './progress';
import { Block } from './scoring/evaluate';

/**
 * Klucze pochodne od JWT_SECRET (HKDF-SHA256 ze stałym `info` osobnym dla każdego zastosowania), więc bez nowej zmiennej
 * środowiskowej, a klucz do tasowania i do nieprzejrzystych id nie jest kluczem JWT ani nie jest sobie równy. Zmiana JWT_SECRET
 * zmienia tylko kolejność wyświetlania i wygląd id (odpowiedzi idą po id nadanym w tej samej sesji, nie po pozycji).
 */
function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
}

/**
 * Kontekst projekcji treści dla JEDNEGO przypisania i jego wersji. Wszystko jest HMAC-iem z kluczem SERWERA, stałym dla
 * (przypisanie, wersja, blok[, element]):
 *  - seed tasowania: odświeżenie strony nie daje nowej permutacji (inaczej porównanie dwóch układów odsłaniałoby kolejność),
 *    a bez klucza nie da się permutacji odwrócić do kolejności z treści (= odpowiedź);
 *  - nieprzejrzyste id elementów (ORDERING, EMAIL_ANALYSIS): inne w każdym przypisaniu, więc nazwy id w treści nie zdradzają
 *    klucza, a id z cudzego przypisania nie da się użyć (mapowanie z powrotem tylko po stronie serwera, evaluate.ts).
 */
export function shuffleContext(secret: string, assignmentId: string, versionId: string): ClientContext {
  const shuffleKey = deriveKey(secret, 'content-shuffle');
  const idKey = deriveKey(secret, 'content-opaque-id');
  const scope = `${assignmentId}\n${versionId}`;
  return {
    shuffleSeed: (blockId: string): ShuffleSeed => {
      const digest = createHmac('sha256', shuffleKey).update(`${scope}\n${blockId}`).digest();
      return [digest.readUInt32BE(0), digest.readUInt32BE(4), digest.readUInt32BE(8), digest.readUInt32BE(12)];
    },
    // 96 bitów w hex: zgodne z idSchema (odpowiedź klienta przechodzi tę samą walidację co zwykłe id), bez kolizji w praktyce.
    opaqueId: (blockId: string, itemId: string): string =>
      createHmac('sha256', idKey).update(`${scope}\n${blockId}\n${itemId}`).digest('hex').slice(0, 24),
  };
}

interface ClientNote {
  key: string;
  blockId: string;
  text: string;
}

/** Treść notatki z treści modułu (klient nigdy nie wysyła treści notatek). */
export function resolveNote(blocks: Block[], key: string): ClientNote | null {
  const dot = key.indexOf('.');
  if (dot < 1) return null;
  const blockId = key.slice(0, dot);
  const itemId = key.slice(dot + 1);
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;
  const items: { id: string; note?: { text?: string } }[] =
    block.type === 'DIALOGUE' ? block.questions : block.type === 'EMAIL_ANALYSIS' ? block.criteria : [];
  const item = Array.isArray(items) ? items.find((i) => i.id === itemId) : undefined;
  return item?.note?.text ? { key, blockId, text: item.note.text } : null;
}

/**
 * Widok postępu dla klienta: własne wyniki i stan, plus WYŁĄCZNIE ujawnione dotąd elementy zadań tekstowych (podpowiedzi
 * odsłonięte próbami; rozwiązanie po wyczerpaniu prób) i rozwiązane notatki. Niczego, co nie było jeszcze ujawnione.
 */
export function clientProgress(progress: ProgressV2, blocks: Block[]) {
  const view: Record<string, unknown> = {};
  for (const [blockId, entry] of Object.entries(progress.blocks)) {
    const block = blocks.find((b) => b.id === blockId);
    const revealedHints =
      block?.type === 'TEXT_INPUT_GUIDED' && Array.isArray(block.hints) ? block.hints.slice(0, entry.hintsShown ?? 0) : undefined;
    const solution = block?.type === 'TEXT_INPUT_GUIDED' && entry.done && entry.correct === false ? block.solution : undefined;
    view[blockId] = {
      type: entry.type,
      done: entry.done,
      ...(entry.correct !== undefined ? { correct: entry.correct } : {}),
      ...(entry.points !== undefined ? { points: entry.points } : {}),
      ...(entry.attempts !== undefined ? { attempts: entry.attempts } : {}),
      ...(revealedHints && revealedHints.length > 0 ? { revealedHints } : {}),
      ...(solution ? { solution } : {}),
    };
  }
  // Klucz notatki (`<blockId>.<itemId>`) zawiera id elementu Z TREŚCI (np. kryterium maila), więc do klienta idzie tylko blockId i
  // treść: klient buduje klucz listy z indeksu. Żadne id z treści (poza id bloku) nie wychodzi w progress.
  const notes = progress.notes
    .map((key) => resolveNote(blocks, key))
    .filter((n): n is ClientNote => n !== null)
    .map(({ blockId, text }) => ({ blockId, text }));
  return { v: 2 as const, blocks: view, notes };
}
