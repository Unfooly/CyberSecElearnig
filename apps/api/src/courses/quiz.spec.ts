import { ProgressV2, readProgress } from './progress';
import { QUIZ_PASS_PERCENT, finalQuizIndexes, quizScore, quizViewOf, readQuizState } from './quiz';
import type { Block } from './scoring/evaluate';

// Quiz modułu (D-207): zakres (ciąg pytań przed raportem), wynik z jednej próby, próg 75%, stan w postępie.

const block = (id: string, type: string) => ({ id, type }) as unknown as Block;
const entry = (correct: boolean) => ({ type: 'QUIZ', done: true, answeredAt: '2026-11-23T10:00:00.000Z', weight: 1, correct, points: correct ? 1 : 0 });

describe('finalQuizIndexes (D-207)', () => {
  it('ciąg pytań tuż przed raportem; pytanie w środku historii się nie liczy', () => {
    const blocks = [block('a', 'NARRATIVE'), block('cwiczenie', 'QUIZ'), block('b', 'NARRATIVE'), block('q1', 'QUIZ'), block('q2', 'QUIZ'), block('raport', 'SUMMARY')];
    expect(finalQuizIndexes(blocks, true)).toEqual([3, 4]);
  });

  it('quiz na samym końcu (bez raportu); bez pytań na końcu, poza trybem prostym i pusty moduł - brak quizu', () => {
    expect(finalQuizIndexes([block('a', 'NARRATIVE'), block('q1', 'QUIZ')], true)).toEqual([1]);
    expect(finalQuizIndexes([block('q1', 'QUIZ'), block('s', 'SWIPE_SORT'), block('raport', 'SUMMARY')], true)).toEqual([]);
    expect(finalQuizIndexes([block('q1', 'QUIZ'), block('raport', 'SUMMARY')], false)).toEqual([]);
    expect(finalQuizIndexes([], true)).toEqual([]);
  });
});

describe('quizScore (D-207): próg 75%', () => {
  const blocks = ['q1', 'q2', 'q3', 'q4'].map((id) => block(id, 'QUIZ'));
  const progress = (answers: boolean[]): ProgressV2 => ({
    v: 2,
    notes: [],
    blocks: Object.fromEntries(answers.map((correct, i) => [`q${i + 1}`, entry(correct)])) as ProgressV2['blocks'],
  });

  it('3 z 4 (75%) - zaliczony; 2 z 4 - nie; brak odpowiedzi liczy się jako zła', () => {
    expect(QUIZ_PASS_PERCENT).toBe(75);
    expect(quizScore(progress([true, true, true, false]), blocks, [0, 1, 2, 3])).toEqual({ correct: 3, total: 4, passed: true });
    expect(quizScore(progress([true, false, true, false]), blocks, [0, 1, 2, 3])).toEqual({ correct: 2, total: 4, passed: false });
    expect(quizScore(progress([true, true, true]), blocks, [0, 1, 2, 3])).toEqual({ correct: 3, total: 4, passed: true });
    expect(quizScore(progress([true]), blocks, [0, 1])).toEqual({ correct: 1, total: 2, passed: false });
  });
});

describe('stan quizu w postępie (D-207)', () => {
  it('readProgress zachowuje poprawny `quiz`, odrzuca zły kształt', () => {
    const quiz = { attempts: 2, failed: true, correct: 1, total: 4 };
    expect(readProgress({ v: 2, blocks: {}, notes: [], quiz }).quiz).toEqual(quiz);
    expect(readProgress({ v: 2, blocks: {}, notes: [], quiz: { attempts: -1, failed: true, correct: 0, total: 1 } }).quiz).toBeUndefined();
    expect(readQuizState({ attempts: 1, failed: 'tak', correct: 0, total: 1 })).toBeUndefined();
    expect(readQuizState(null)).toBeUndefined();
  });

  it('widok /start: id pytań, próg, wynik ostatniego podejścia; po powtórce (total 0) - bez wyniku', () => {
    const blocks = [block('a', 'NARRATIVE'), block('q1', 'QUIZ'), block('raport', 'SUMMARY')];
    const base: ProgressV2 = { v: 2, blocks: {}, notes: [] };
    expect(quizViewOf(blocks, true, base)).toEqual({ blockIds: ['q1'], passPercent: 75, result: null });
    expect(quizViewOf(blocks, true, { ...base, quiz: { attempts: 1, failed: true, correct: 0, total: 1 } })?.result).toEqual({
      correct: 0,
      total: 1,
      passPercent: 75,
      passed: false,
      attempts: 1,
    });
    expect(quizViewOf(blocks, true, { ...base, quiz: { attempts: 1, failed: false, correct: 0, total: 0 } })?.result).toBeNull();
    expect(quizViewOf(blocks, false, base)).toBeNull();
  });
});
