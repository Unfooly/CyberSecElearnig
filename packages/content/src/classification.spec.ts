import {
  BLOCK_SCHEMAS,
  BLOCK_TYPES,
  BlockType,
  FIELD_CLASSIFICATION,
  FieldClassification,
  ShuffleSeed,
  collectPaths,
  leafPaths,
  pickByPaths,
  seededShuffle,
  toClientBlock,
} from './index';
import { SECRET_MARKER, fullModule, leakProbeBlocks } from './fixtures';
import { parseModule } from './node';

const context = {
  shuffleSeed: (blockId: string): ShuffleSeed => [blockId.length, 7, 11, 13],
  opaqueId: (blockId: string, itemId: string) => `x${blockId.length}${itemId.length}${itemId.split('').reverse().join('')}`,
};
const DERIVED_CLIENT_PATHS = ['hintCount'];

describe('klasyfikacja pól bloków (client / secret)', () => {
  it('fixtura pełnego modułu przechodzi walidację (każdy typ bloku raz)', () => {
    expect(() => parseModule(fullModule())).not.toThrow();
    expect(new Set(fullModule().blocks.map((b) => b.type))).toEqual(new Set(BLOCK_TYPES));
  });

  it.each(BLOCK_TYPES)('%s: każde pole schematu jest sklasyfikowane dokładnie raz (nowe pole bez decyzji wywala test)', (type) => {
    const schemaPaths = leafPaths(BLOCK_SCHEMAS[type]).sort();
    const { client, secret } = FIELD_CLASSIFICATION[type];
    const overlap = client.filter((path) => secret.includes(path));
    expect(overlap).toEqual([]);
    expect([...client, ...secret].sort()).toEqual(schemaPaths);
  });

  it.each(BLOCK_TYPES)('%s: fixtura wypełnia wszystkie sklasyfikowane pola (inaczej test wycieku byłby ślepy)', (type) => {
    const present = new Set(collectPaths(leakProbeBlocks()[type]));
    const { client, secret } = FIELD_CLASSIFICATION[type];
    for (const path of [...client, ...secret]) {
      expect(present).toContain(path);
    }
  });
});

describe('toClientBlock: brak wycieku klucza odpowiedzi', () => {
  it.each(BLOCK_TYPES)('%s: odpowiedź zawiera wyłącznie pola z listy client i żadnego sekretu', (type) => {
    const projected = toClientBlock(leakProbeBlocks()[type], context);
    const { client, secret } = FIELD_CLASSIFICATION[type];
    const paths = collectPaths(projected);

    for (const path of paths) {
      expect([...client, ...DERIVED_CLIENT_PATHS]).toContain(path);
    }
    for (const path of secret) {
      expect(paths).not.toContain(path);
    }
    expect(JSON.stringify(projected)).not.toContain(SECRET_MARKER);
  });

  it('nieznany typ bloku dostaje tylko id i type (nic, czego nie umiemy sklasyfikować)', () => {
    expect(toClientBlock({ id: 'x', type: 'NOWY_TYP', correct: true, tajne: 'SEKRET' }, context)).toEqual({
      id: 'x',
      type: 'NOWY_TYP',
    });
  });

  it('nieznane pole znanego typu jest wycinane (biała lista, nie czarna)', () => {
    const projected = toClientBlock({ ...leakProbeBlocks().VIDEO, nowePole: 'SEKRET', url: 'https://x.test/v.mp4' }, context);
    expect(JSON.stringify(projected)).not.toContain('SEKRET');
    expect(projected).not.toHaveProperty('nowePole');
  });

  it('treść podpowiedzi TEXT_INPUT_GUIDED nie wychodzi, klient dostaje tylko ich liczbę', () => {
    const projected = toClientBlock(leakProbeBlocks().TEXT_INPUT_GUIDED, context);
    expect(projected.hintCount).toBe(1);
    expect(projected).not.toHaveProperty('hints');
    expect(projected).not.toHaveProperty('solution');
    expect(projected).not.toHaveProperty('answer');
  });

  it('opcje QUIZ/BRANCHING tracą correct, outcome i feedback (także w blokach starego formatu)', () => {
    const legacy = {
      id: 'b1',
      type: 'BRANCHING_SCENARIO',
      title: 'Stary blok',
      prompt: 'Co robisz?',
      options: [{ text: 'A', outcome: 'wrong', feedback: 'Źle, bo SEKRET' }, { text: 'B', outcome: 'correct', feedback: 'Dobrze' }],
      innePole: 'SEKRET',
    };
    const projected = toClientBlock(legacy, context);
    expect(projected.options).toEqual([{ text: 'A' }, { text: 'B' }]);
    expect(JSON.stringify(projected)).not.toContain('SEKRET');
  });

  // Test mutacyjny: dla KAŻDEGO pola sekretnego każdego typu symulujemy błąd "pole przeniesione do listy client" i sprawdzamy,
  // że detektor wycieku (jak w teście powyżej) to zauważa. Test, który nie umie zawieść, niczego nie chroni.
  describe('test mutacyjny detektora wycieku', () => {
    const cases = BLOCK_TYPES.flatMap((type) => FIELD_CLASSIFICATION[type].secret.map((path) => [type, path] as const));

    it.each(cases)('%s: wyciek pola "%s" zostaje wykryty', (type, path) => {
      const mutated = {
        ...FIELD_CLASSIFICATION,
        [type]: { client: [...FIELD_CLASSIFICATION[type].client, path], secret: FIELD_CLASSIFICATION[type].secret },
      } as Record<BlockType, FieldClassification>;

      const projected = toClientBlock(leakProbeBlocks()[type], context, mutated);
      const leaked = FIELD_CLASSIFICATION[type].secret.filter((secretPath) => collectPaths(projected).includes(secretPath));

      expect(leaked).toContain(path);
    });
  });
});

describe('seededShuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('jest deterministyczny dla tego samego seeda i jest permutacją', () => {
    const first = seededShuffle(items, [1, 2, 3, 4]);
    expect(seededShuffle(items, [1, 2, 3, 4])).toEqual(first);
    expect([...first].sort()).toEqual(items);
  });

  it('różne seedy dają różne kolejności', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 50; i += 1) orders.add(seededShuffle(items, [i, 2, 3, 4]).join(''));
    expect(orders.size).toBeGreaterThan(5);
  });

  it('nie ma reguły "nigdy tożsamość": przy 2 elementach oba układy są możliwe (odwrócenie nie jest stałą odpowiedzią)', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 200; i += 1) orders.add(seededShuffle(['a', 'b'], [i, i * 3, 5, 9]).join(''));
    expect(orders).toEqual(new Set(['ab', 'ba']));
  });

  it('rozkład permutacji trzech elementów obejmuje wszystkie 6 układów (także wejściowy)', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 400; i += 1) orders.add(seededShuffle(['a', 'b', 'c'], [i, 3, 5, 9]).join(''));
    expect(orders.size).toBe(6);
  });

  it('elementy ORDERING i kryteria EMAIL_ANALYSIS w odpowiedzi są przetasowane wg seeda serwera i mają nieprzejrzyste id', () => {
    const ordering = leakProbeBlocks().ORDERING;
    const realIds = (ordering.items as { id: string }[]).map((item) => item.id);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const projected = toClientBlock(ordering, { ...context, shuffleSeed: () => [i, 1, 2, 3] });
      const ids = (projected.items as { id: string }[]).map((item) => item.id);
      for (const realId of realIds) expect(ids).not.toContain(realId);
      seen.add(ids.join(','));
    }
    expect(seen.size).toBeGreaterThan(1);

    const email = toClientBlock(leakProbeBlocks().EMAIL_ANALYSIS, context);
    const criteriaIds = (email.criteria as { id: string }[]).map((c) => c.id);
    for (const realId of ['c1', 'c2', 'c3']) expect(criteriaIds).not.toContain(realId);
  });

  it('ORDERING: start/end tablicy śledczej (D-088) trafiają do klienta, wyjaśnienie i punktacja nie', () => {
    const projected = toClientBlock(leakProbeBlocks().ORDERING, context);
    expect(projected.start).toEqual({ label: 'A.K.', caption: 'Pracownik' });
    expect(projected.end).toEqual({ label: '−1 000 zł', caption: 'Strata' });
    expect(projected.explanation).toBeUndefined();
    expect(projected.scoring).toBeUndefined();
  });
});

describe('pickByPaths', () => {
  it('nie pozwala wstrzyknąć __proto__ z danych', () => {
    const data = JSON.parse('{"a":1,"__proto__":{"polluted":true},"nested":{"__proto__":{"polluted":true},"b":2}}');
    const picked = pickByPaths(data, ['a', 'nested.b']) as Record<string, unknown>;
    expect(picked).toEqual({ a: 1, nested: { b: 2 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('zachowuje wartości false i 0', () => {
    expect(pickByPaths({ ok: false, n: 0 }, ['ok', 'n'])).toEqual({ ok: false, n: 0 });
  });
});
