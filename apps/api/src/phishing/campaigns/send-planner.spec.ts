import { planSendTimes, shuffled } from './send-planner';

// Deterministyczny generator (LCG) - testy planera bez losowości i bez czekania.
const seeded = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return seed / 4_294_967_296;
};

const FROM = new Date('2026-10-01T08:00:00.000Z');
const TO = new Date('2026-10-01T16:00:00.000Z');

describe('planSendTimes', () => {
  it('zwraca dokładnie n momentów, wszystkie w oknie [from, to], posortowane rosnąco', () => {
    const times = planSendTimes(500, FROM, TO, seeded(1));

    expect(times).toHaveLength(500);
    for (const time of times) {
      expect(time.getTime()).toBeGreaterThanOrEqual(FROM.getTime());
      expect(time.getTime()).toBeLessThanOrEqual(TO.getTime());
    }
    expect(times.map((t) => t.getTime())).toEqual([...times.map((t) => t.getTime())].sort((a, b) => a - b));
  });

  it('rozkład jest jednostajny: w każdej ósmej części okna ląduje zbliżona liczba wiadomości (nie ma fali)', () => {
    const times = planSendTimes(8000, FROM, TO, seeded(7));
    const buckets = new Array<number>(8).fill(0);
    for (const time of times) {
      buckets[Math.min(7, Math.floor(((time.getTime() - FROM.getTime()) / (TO.getTime() - FROM.getTime())) * 8))] += 1;
    }

    for (const count of buckets) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it('jest deterministyczny dla tego samego generatora i różny dla innego', () => {
    expect(planSendTimes(20, FROM, TO, seeded(3))).toEqual(planSendTimes(20, FROM, TO, seeded(3)));
    expect(planSendTimes(20, FROM, TO, seeded(3))).not.toEqual(planSendTimes(20, FROM, TO, seeded(4)));
  });

  it('granice: rng = 0 => początek okna, rng ≈ 1 => koniec okna, generator spoza zakresu jest przycinany', () => {
    expect(planSendTimes(1, FROM, TO, () => 0)[0]).toEqual(FROM);
    expect(planSendTimes(1, FROM, TO, () => 0.9999999999)[0].getTime()).toBeLessThanOrEqual(TO.getTime());
    expect(planSendTimes(1, FROM, TO, () => 5)[0]).toEqual(TO);
    expect(planSendTimes(1, FROM, TO, () => -3)[0]).toEqual(FROM);
  });

  it('zerowa liczba odbiorców i okno o zerowej długości działają; błędne dane => błąd', () => {
    expect(planSendTimes(0, FROM, TO)).toEqual([]);
    expect(planSendTimes(3, FROM, FROM, seeded(1))).toEqual([FROM, FROM, FROM]);
    expect(() => planSendTimes(-1, FROM, TO)).toThrow();
    expect(() => planSendTimes(1.5, FROM, TO)).toThrow();
    expect(() => planSendTimes(1, TO, FROM)).toThrow(/okno/i);
    expect(() => planSendTimes(1, new Date('nie-data'), TO)).toThrow(/okno/i);
  });
});

describe('shuffled', () => {
  it('zwraca permutację, nie zmienia wejścia, jest deterministyczne dla danego generatora', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];

    const result = shuffled(input, seeded(5));

    expect([...result].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result).not.toEqual(input);
    expect(shuffled(input, seeded(5))).toEqual(result);
    expect(shuffled([], seeded(1))).toEqual([]);
  });

  it('przypisanie posortowanych czasów po tasowaniu NIE koreluje z kolejnością wejścia (odbiorca nr 0 nie dostaje zawsze pierwszy)', () => {
    const times = planSendTimes(100, FROM, TO, seeded(9)).map((t) => t.getTime());
    let firstRecipientRankSum = 0;
    const runs = 300;
    for (let run = 0; run < runs; run += 1) {
      const assigned = shuffled(times); // domyślny, kryptograficzny generator
      firstRecipientRankSum += times.indexOf(assigned[0]);
    }

    const meanRank = firstRecipientRankSum / runs;
    expect(meanRank).toBeGreaterThan(35);
    expect(meanRank).toBeLessThan(65); // bez tasowania byłoby 0
  });
});
