import { ContentValidationError, toClientBlock } from './index';
import { fullModule, fullModuleV6 } from './fixtures';
import { parseModule, replayLiveCall } from './node';

// Rozmowa na żywo (D-122, moduł 2 faza 1e): drzewo rozmowy z dzwoniącym, cisza po limicie czasu, ocena zakończenia i odpowiedzi oddające
// informację - sekret.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

const errorsOf = (module: unknown): string => {
  try {
    parseModule(module);
  } catch (e) {
    return (e as ContentValidationError).issues.join('\n');
  }
  return '';
};
const mutate = (change: (m: AnyModule) => void): AnyModule => {
  const m = fullModuleV6() as AnyModule;
  change(m);
  return m;
};
const call = (m: AnyModule) => m.blocks.find((b: AnyModule) => b.type === 'LIVE_CALL');
const node = (m: AnyModule, id: string) => call(m).nodes.find((n: AnyModule) => n.id === id);

describe('LIVE_CALL: walidacja', () => {
  it('fixtura v6 przechodzi; blok wymaga schemaVersion 6', () => {
    expect(errorsOf(fullModuleV6())).toBe('');
    const m = fullModule() as AnyModule;
    const block = call(fullModuleV6());
    for (const n of block.nodes) delete n.narration.voice;
    for (const e of block.endings) delete e.narration.voice;
    m.blocks.splice(m.blocks.length - 1, 0, block);
    expect(errorsOf(m)).toContain('blok LIVE_CALL wymaga schemaVersion 6');
  });

  it('krawędź do nieistniejącego węzła lub zakończenia, nieznany start', () => {
    expect(errorsOf(mutate((m) => (node(m, 'start').choices[1].next = 'nie-ma')))).toContain('krawędź "nie-ma" prowadzi donikąd');
    expect(errorsOf(mutate((m) => (node(m, 'nacisk').silence = '#nie-ma')))).toContain('krawędź "#nie-ma" prowadzi donikąd');
    expect(errorsOf(mutate((m) => (call(m).start = 'nie-ma')))).toContain('start: nieznany węzeł "nie-ma"');
  });

  it('cykl, węzeł i zakończenie nieosiągalne', () => {
    expect(errorsOf(mutate((m) => (node(m, 'nacisk').choices[0].next = 'start')))).toContain('cykl w rozmowie');
    expect(
      errorsOf(
        mutate((m) => {
          node(m, 'start').choices[2].next = '#dobre';
        }),
      ),
    ).toContain('węzeł "autorytet" nieosiągalny od start');
    expect(errorsOf(mutate((m) => (node(m, 'autorytet').choices[1].next = '#dobre')))).toContain('zakończenie "czesciowe" nieosiągalne');
  });

  it('co najmniej jedno dobre zakończenie; id odpowiedzi unikalne w bloku, „silence” zarezerwowane; infoChoices istnieją', () => {
    expect(errorsOf(mutate((m) => (call(m).endings[0].outcome = 'partial')))).toContain('co najmniej jedno zakończenie z outcome "good"');
    expect(errorsOf(mutate((m) => (node(m, 'autorytet').choices[0].id = 'rozlaczam')))).toContain('powtórzony identyfikator odpowiedzi "rozlaczam"');
    expect(errorsOf(mutate((m) => (node(m, 'autorytet').choices[0].id = 'silence')))).toContain('id "silence" jest zarezerwowane');
    expect(errorsOf(mutate((m) => call(m).infoChoices.push('nie-ma')))).toContain('infoChoices: nieznana odpowiedź "nie-ma"');
    expect(errorsOf(mutate((m) => (node(m, 'start').id = 'dobre')))).toContain('to samo id węzła i zakończenia');
  });

  it('przypadki brzegowe grafu: pętla na sobie, cykl przez ciszę, powtórzony węzeł; id z "_" i wielką literą jak w idSchema', () => {
    expect(errorsOf(mutate((m) => (node(m, 'autorytet').choices[1].next = 'autorytet')))).toContain('cykl w rozmowie');
    expect(errorsOf(mutate((m) => (node(m, 'nacisk').silence = 'start')))).toContain('cykl w rozmowie');
    expect(errorsOf(mutate((m) => (node(m, 'autorytet').id = 'nacisk')))).toContain('nodes: powtórzony identyfikator "nacisk"');
    expect(
      errorsOf(
        mutate((m) => {
          node(m, 'nacisk').id = 'Nacisk_1';
          node(m, 'start').choices[1].next = 'Nacisk_1';
          node(m, 'start').silence = 'Nacisk_1';
          call(m).endings[2].id = 'k_3';
          node(m, 'Nacisk_1').choices[1].next = '#k_3';
          node(m, 'Nacisk_1').silence = '#k_3';
          node(m, 'autorytet').choices[2].next = '#k_3';
        }),
      ),
    ).toBe('');
  });

  it('dobre zakończenie osiągalne bez ciszy (gracz bez limitu czasu)', () => {
    expect(
      errorsOf(
        mutate((m) => {
          // Dobre zakończenie tylko po ciszy w węźle „nacisk”.
          node(m, 'start').choices[0].next = '#zle';
          node(m, 'nacisk').choices[0].next = '#zle';
          node(m, 'autorytet').choices[0].next = '#zle';
          node(m, 'nacisk').silence = '#dobre';
        }),
      ),
    ).toContain('zakończenie "good" musi być osiągalne bez ciszy');
  });

  it('kwestia dzwoniącego wymaga roli głosu; 2-4 odpowiedzi w węźle', () => {
    expect(errorsOf(mutate((m) => delete node(m, 'start').narration.voice))).toContain('kwestia dzwoniącego wymaga roli głosu');
    expect(errorsOf(mutate((m) => node(m, 'nacisk').choices.splice(1, 1)))).not.toBe('');
  });

  it('klient: drzewo i teksty zakończeń, bez oceny zakończeń i infoChoices', () => {
    const client = toClientBlock(call(fullModuleV6()), { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (b, i) => `${b}-${i}` }) as AnyModule;
    expect(client.nodes[0].choices[0]).toEqual({ id: 'oddzwonie', text: 'Oddzwonię na numer z intranetu.', next: '#dobre' });
    expect(client.nodes[0].silence).toBe('nacisk');
    expect(client.endings.map((e: AnyModule) => e.id)).toEqual(['dobre', 'czesciowe', 'zle']);
    expect(client.endings.some((e: AnyModule) => 'outcome' in e)).toBe(false);
    expect('infoChoices' in client).toBe(false);
    expect(client.caller).toEqual({ display: 'IT Helpdesk', number: '12 3XX XX 41' });
  });
});

describe('LIVE_CALL: przejście drzewa (replayLiveCall)', () => {
  const block = call(fullModuleV6()) as Parameters<typeof replayLiveCall>[0];

  it('ścieżki zgodne z grafem kończą się zakończeniem; przebyte odpowiedzi bez ciszy', () => {
    expect(replayLiveCall(block, ['oddzwonie'], { allowSilence: true })).toEqual({ ending: 'dobre', choices: ['oddzwonie'] });
    expect(replayLiveCall(block, ['sprawdze', 'instaluje'], { allowSilence: false })).toEqual({ ending: 'zle', choices: ['sprawdze', 'instaluje'] });
    expect(replayLiveCall(block, ['silence', 'rozlaczam'], { allowSilence: true })).toEqual({ ending: 'dobre', choices: ['rozlaczam'] });
    expect(replayLiveCall(block, ['silence', 'silence'], { allowSilence: true })).toEqual({ ending: 'zle', choices: [] });
  });

  it('odrzuca: ciszę bez limitu albo bez krawędzi, nieznaną odpowiedź, odpowiedź z innego węzła, ścieżkę za krótką i za długą', () => {
    expect(replayLiveCall(block, ['silence', 'rozlaczam'], { allowSilence: false })).toBeNull();
    expect(replayLiveCall(block, ['sprawdze', 'silence'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall(block, ['nie-ma'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall(block, ['rozlaczam'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall(block, ['jaka-liczba'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall(block, [], { allowSilence: true })).toBeNull();
    expect(replayLiveCall(block, ['oddzwonie', 'rozlaczam'], { allowSilence: true })).toBeNull();
  });

  it('uszkodzona treść: null zamiast wyjątku', () => {
    expect(replayLiveCall({ ...block, nodes: undefined } as never, ['oddzwonie'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall({ ...block, endings: 'x' } as never, ['oddzwonie'], { allowSilence: true })).toBeNull();
    expect(replayLiveCall({ ...block, nodes: [null, { id: 'start' }] } as never, ['oddzwonie'], { allowSilence: true })).toBeNull();
  });
});
