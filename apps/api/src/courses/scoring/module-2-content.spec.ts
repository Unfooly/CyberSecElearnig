import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizeContent } from '@cyberszkolo/content';
import { parseModule } from '@cyberszkolo/content/dist/node';
import { module2Facts } from '../../gamification/achievements';
import { ProgressV2 } from '../progress';
import { Block, evaluateSubmit } from './evaluate';

// Treść modułu 2 (`glos-z-helpdesku`) w ocenie serwera - uwagi właściciela po przejściu modułu (D-129): strategia „flaguj wszystko, co
// mówi dzwoniący” nie może dawać pełnego wyniku ani Perfect Pitch; odrzucenie połączenia i rozłączenie się to dobra reakcja.

const MODULE_2 = join(__dirname, '../../../../../packages/content/modules/glos-z-helpdesku/module.json');
const blocks = localizeContent(parseModule(JSON.parse(readFileSync(MODULE_2, 'utf8'))).blocks, 'pl') as unknown as Block[];
const now = new Date('2026-09-30T12:00:00.000Z');
const opaque = (blockId: string, itemId: string) => `op-${blockId}-${itemId}`;
const blockOf = (type: string) => blocks.find((block) => block.type === type)!;

function facts(block: Block, answer: unknown) {
  const { entry } = evaluateSubmit(block, answer, undefined, now, opaque);
  const progress: ProgressV2 = { v: 2, blocks: { [block.id]: entry }, notes: [] };
  return { entry, facts: module2Facts(progress, blocks) };
}

describe('moduł 2: odsłuch nagrania (CALL_RECORDING)', () => {
  const recording = blockOf('CALL_RECORDING');
  const segments = recording.segments as { id: string; speaker: string }[];
  const flags = (recording.flags as { segmentId: string }[]).map((flag) => flag.segmentId);
  const callerLines = segments.filter((segment) => segment.speaker === 'Dzwoniący').map((segment) => segment.id);

  it('dzwoniący ma co najmniej 3 kwestie bez flagi (neutralne)', () => {
    expect(callerLines.filter((id) => !flags.includes(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('oflagowanie WSZYSTKICH kwestii dzwoniącego - wynik < 0,8 i bez Perfect Pitch', () => {
    const { entry, facts: result } = facts(recording, { taps: callerLines.map((segmentId) => ({ segmentId })) });
    expect(entry.points).toBeLessThan(0.8);
    expect(entry.falseTaps).toBeGreaterThanOrEqual(3);
    expect(result.perfectPitch).toBe(false);
  });

  it('dokładnie flagi (bez neutralnych) - pełny wynik i Perfect Pitch', () => {
    const { entry, facts: result } = facts(recording, { taps: flags.map((segmentId) => ({ segmentId })) });
    expect(entry.points).toBe(1);
    expect(result.perfectPitch).toBe(true);
  });
});

describe('moduł 2: rozmowa na żywo (LIVE_CALL)', () => {
  const call = blockOf('LIVE_CALL');

  it('„Odrzuć” - dobre zakończenie z oddzwonieniem na 214, wynik 1 i Dead Air', () => {
    const { entry, facts: result } = facts(call, { path: ['reject'], timed: true });
    expect(entry).toMatchObject({ correct: true, points: 1 });
    expect(result.deadAir).toBe(true);
    const ending = (call.endings as { id: string; narration: { text: string } }[]).find((e) => `#${e.id}` === call.reject)!;
    expect(ending.narration.text).toContain('214');
  });

  it('„Rozłącz” bez oddanej informacji - dobre zakończenie (w każdym węźle)', () => {
    for (const path of [['hangup'], ['jaka-liczba', 'hangup'], ['sprawdze', 'co-mam-zrobic', 'hangup']]) {
      expect(facts(call, { path, timed: false }).entry).toMatchObject({ correct: true, points: 1 });
    }
  });
});
