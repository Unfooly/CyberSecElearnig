import { ContentValidationError, toClientBlock } from './index';
import { SECRET_MARKER, fullModuleV6, simpleModule } from './fixtures';
import { isOneSentence, parseModule } from './node';

// Tryb prosty (D-132): walidacja przy budowaniu treści (błędy, nie ostrzeżenia) i blok SWIPE_SORT.

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
  const m = simpleModule() as AnyModule;
  change(m);
  return m;
};
const byType = (m: AnyModule, type: string) => m.blocks.find((b: AnyModule) => b.type === type);

describe('tryb prosty (simpleMode)', () => {
  it('poprawny moduł przechodzi walidację', () => {
    expect(errorsOf(simpleModule())).toBe('');
  });

  it('odrzuca blok ORDERING (i każdy inny spoza listy dozwolonych)', () => {
    const ordering = fullModuleV6().blocks.find((b) => b.type === 'ORDERING');
    const m = mutate((module) => module.blocks.splice(1, 0, ordering));
    expect(errorsOf(m)).toMatch(/tryb prosty nie dopuszcza bloku ORDERING/);
    for (const type of ['INTERROGATION', 'CALL_RECORDING', 'LIVE_CALL', 'OSINT_SPOT']) {
      const block = fullModuleV6().blocks.find((b) => b.type === type);
      expect(errorsOf(mutate((module) => module.blocks.splice(1, 0, block)))).toMatch(new RegExp(`tryb prosty nie dopuszcza bloku ${type}`));
    }
  });

  it('odrzuca polecenie dłuższe niż 90 znaków i polecenie z dwoma zdaniami (prompt i tip)', () => {
    const long = mutate((m) => (byType(m, 'QUIZ').prompt = `${'Co robisz w tej sytuacji, kiedy nie wiesz, kto napisał '.repeat(2)}?`));
    expect(errorsOf(long)).toMatch(/prompt: tryb prosty - polecenie najwyżej 90 znaków/);
    const two = mutate((m) => (byType(m, 'SCENE_HOTSPOTS').tip = 'Obejrzyj telefon. Kliknij link.'));
    expect(errorsOf(two)).toMatch(/tip: tryb prosty - polecenie to jedno zdanie/);
    const swipe = mutate((m) => (byType(m, 'SWIPE_SORT').prompt = 'Oceń wiadomości. Przesuń w lewo albo w prawo.'));
    expect(errorsOf(swipe)).toMatch(/prompt: tryb prosty - polecenie to jedno zdanie/);
  });

  it('wybór: 2-3 odpowiedzi, dokładnie jedna poprawna, każda z feedbackiem <= 140 znaków, podpowiedź wymagana', () => {
    const four = mutate((m) => byType(m, 'QUIZ').options.push({ text: 'A', correct: false, feedback: 'Nie.' }, { text: 'B', correct: false, feedback: 'Nie.' }));
    expect(errorsOf(four)).toMatch(/2-3 odpowiedzi \(jest 4\)/);
    const twoCorrect = mutate((m) => (byType(m, 'QUIZ').options[0].correct = true));
    expect(errorsOf(twoCorrect)).toMatch(/dokładnie jedna poprawna odpowiedź/);
    const noFeedback = mutate((m) => delete byType(m, 'QUIZ').options[1].feedback);
    expect(errorsOf(noFeedback)).toMatch(/options\[1\]\.feedback: tryb prosty - każda odpowiedź ma zdanie po kliknięciu/);
    const longFeedback = mutate((m) => (byType(m, 'QUIZ').options[0].feedback = 'x'.repeat(141)));
    expect(errorsOf(longFeedback)).toMatch(/options\[0\]\.feedback: tryb prosty - najwyżej 140 znaków/);
    const noHint = mutate((m) => delete byType(m, 'QUIZ').hint);
    expect(errorsOf(noHint)).toMatch(/hint: tryb prosty - podpowiedź po 2 błędach jest wymagana/);
  });

  it('scena: najwyżej 4 cele, każdy min. 44×44 px w skali wyświetlania', () => {
    const five = mutate((m) => {
      const scene = byType(m, 'SCENE_HOTSPOTS');
      scene.hotspots.push({ ...scene.hotspots[0], id: 'a', y: 70 }, { ...scene.hotspots[0], id: 'b', x: 60, y: 70 });
    });
    expect(errorsOf(five)).toMatch(/najwyżej 4 cele \(jest 5\)/);
    const small = mutate((m) => Object.assign(byType(m, 'SCENE_HOTSPOTS').hotspots[0], { width: 5, height: 10 }));
    expect(errorsOf(small)).toMatch(/hotspots\[0\] \(link\): tryb prosty - cel dotykowy min\. 44×44 px na scenie 480×270 px \(jest 24×27\)/);
    const nested = mutate((m) => {
      const scene = byType(m, 'SCENE_HOTSPOTS');
      scene.hotspots[2] = {
        id: 'ekran',
        label: 'Ekran',
        x: 50,
        y: 40,
        width: 30,
        height: 20,
        media: { kind: 'scene', scene: { image: 'scenes/ekran.svg', imageAlt: 'Ekran', hotspots: [{ id: 'maly', label: 'Mały', x: 1, y: 1, width: 4, height: 4, content: 'Mały cel.' }] } },
      };
    });
    expect(errorsOf(nested)).toMatch(/hotspots\[2\]\.media\.scene\.hotspots\[0\] \(maly\): tryb prosty - cel dotykowy min\. 44×44 px na scenie 401×216 px/);
    // 10% × 20% przechodzi na scenie głównej (48×54 px), ale nie w zagnieżdżonej (40×43 px).
    const borderline = mutate((m) => {
      const scene = byType(m, 'SCENE_HOTSPOTS');
      scene.hotspots[2] = {
        id: 'ekran',
        label: 'Ekran',
        x: 50,
        y: 40,
        width: 30,
        height: 20,
        media: { kind: 'scene', scene: { image: 'scenes/ekran.svg', imageAlt: 'Ekran', hotspots: [{ id: 'graniczny', label: 'Graniczny', x: 1, y: 1, width: 10, height: 20, content: 'Cel.' }] } },
      };
    });
    expect(errorsOf(borderline)).toMatch(/\(graniczny\): tryb prosty - cel dotykowy min\. 44×44 px na scenie 401×216 px \(jest 40×43\)/);
  });

  it('scena bez własnego polecenia (tip) - błąd: domyślna podpowiedź sceny ma dwa zdania', () => {
    expect(errorsOf(mutate((m) => delete byType(m, 'SCENE_HOTSPOTS').tip))).toMatch(/tip: tryb prosty - scena wymaga własnego polecenia/);
  });

  it('karta SWIPE_SORT: feedback najwyżej 140 znaków (schemat) i oba werdykty w bloku', () => {
    const longFeedback = mutate((m) => (byType(m, 'SWIPE_SORT').cards[0].feedback = 'x'.repeat(141)));
    expect(errorsOf(longFeedback)).toMatch(/cards\.0\.feedback/);
    const oneVerdict = mutate((m) => (byType(m, 'SWIPE_SORT').cards[1].correct = 'suspicious'));
    expect(errorsOf(oneVerdict)).toMatch(/cards: brak karty z werdyktem "ok"/);
  });

  it('bez simpleMode zasady trybu prostego nie obowiązują (moduł 2 ma ORDERING i długie polecenia)', () => {
    expect(errorsOf(fullModuleV6())).toBe('');
    expect(errorsOf(mutate((m) => delete m.simpleMode))).toBe('');
  });

  it('isOneSentence: kończący znak dozwolony, drugie zdanie i nowa linia - nie', () => {
    expect(isOneSentence('Kliknij to, co budzi wątpliwości.')).toBe(true);
    expect(isOneSentence('Co robisz?')).toBe(true);
    expect(isOneSentence('Obejrzyj. Kliknij.')).toBe(false);
    expect(isOneSentence('Obejrzyj\nkliknij')).toBe(false);
  });
});

describe('SWIPE_SORT w projekcji do klienta', () => {
  it('karty bez werdyktu i zdania po werdykcie, bez podpowiedzi; id nieprzejrzyste', () => {
    const block = byType(simpleModule(), 'SWIPE_SORT');
    const client = toClientBlock(block, { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (b, i) => `op-${b}-${i}`.replace(/./g, (c) => c.charCodeAt(0).toString(16)) });
    const json = JSON.stringify(client);
    expect(json).not.toContain(SECRET_MARKER);
    expect(json).not.toContain('"correct"');
    expect(json).not.toContain('"hint"');
    const cards = client.cards as AnyModule[];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual(expect.arrayContaining(['channel', 'from', 'id', 'text']));
      expect(['paczka', 'szef']).not.toContain(card.id);
    }
  });
});
