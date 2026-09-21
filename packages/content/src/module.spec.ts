import { ContentValidationError, withLegacyIds } from './index';
import { fullModule } from './fixtures';
import { hashContent, parseModule } from './node';

// Głęboka kopia z luźnym typem: testy celowo psują moduł.
type TestModule = { blocks: Record<string, any>[]; [key: string]: any };
const fullModuleForTests = (): TestModule => JSON.parse(JSON.stringify(fullModule())) as TestModule;

describe('parseModule: walidacja modułu', () => {
  const expectInvalid = (mutate: (m: TestModule) => void, fragment: string) => {
    const module = fullModuleForTests();
    mutate(module);
    let error: unknown;
    try {
      parseModule(module);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues.join('\n')).toContain(fragment);
  };

  const blockOf = (m: TestModule, type: string) =>
    m.blocks.find((b) => b.type === type) as Record<string, any>;

  it('przyjmuje poprawny moduł i uzupełnia wartości domyślne (zapisywana jest postać po parsowaniu)', () => {
    const module = fullModuleForTests();
    const text = blockOf(module, 'TEXT_INPUT_GUIDED');
    delete text.maxAttempts;
    delete text.normalize;
    delete text.scoring;
    const parsed = parseModule(module);
    const parsedText = parsed.blocks.find((b) => b.type === 'TEXT_INPUT_GUIDED') as Record<string, any>;
    expect(parsedText.maxAttempts).toBe(4);
    expect(parsedText.scoring).toEqual({ attemptPenalty: 0.25, floor: 0.25 });
    expect(parsedText.normalize).toEqual({ trim: true, collapseWhitespace: true });
  });

  it('literówka w nazwie pola to błąd (schematy są strict)', () => {
    expectInvalid((m) => {
      (blockOf(m, 'QUIZ').options[0] as Record<string, unknown>).corect = true;
    }, 'corect');
  });

  it('powtórzony identyfikator bloku', () => {
    expectInvalid((m) => {
      m.blocks[1].id = m.blocks[0].id;
    }, 'powtórzony identyfikator bloku');
  });

  it.each(['constructor', '__proto__', 'a b', '', '-x', 'x'.repeat(65)])('odrzuca niebezpieczny/niepoprawny identyfikator %p', (id) => {
    expectInvalid((m) => {
      m.blocks[0].id = id;
    }, 'blocks.0.id');
  });

  it.each([
    'https://evil.test/a.mp3',
    '//evil.test/a.mp3',
    '/etc/a.mp3',
    '../a.mp3',
    'a/../b.mp3',
    'javascript:alert(1).mp3',
    'a\\b.mp3',
    'audio/a.wav',
  ])('odrzuca ścieżkę audio %p (tylko względne, bez hosta i "..")', (audioUrl) => {
    expectInvalid((m) => {
      (m.blocks[0].narration as Record<string, unknown>).audioUrl = audioUrl;
    }, 'narration.audioUrl');
  });

  describe('narration.cues (napisy z dokładnymi czasami)', () => {
    const narrationOf = (m: TestModule) => m.blocks[0].narration as Record<string, any>;

    it('poprawne cues (rosnące startMs, nie później niż durationMs) przechodzą', () => {
      const module = fullModuleForTests();
      narrationOf(module).cues = [{ text: 'A.', startMs: 0 }, { text: 'B.', startMs: 500 }, { text: 'C.', startMs: 1200 }];
      expect(() => parseModule(module)).not.toThrow();
    });

    it('cues są opcjonalne (fallback: podział proporcjonalny w odtwarzaczu)', () => {
      const module = fullModuleForTests();
      delete narrationOf(module).cues;
      expect(() => parseModule(module)).not.toThrow();
    });

    it('odrzuca cues nierosnące, spoza nagrania, bez nagrania i puste', () => {
      expectInvalid((m) => {
        narrationOf(m).cues = [{ text: 'A.', startMs: 500 }, { text: 'B.', startMs: 100 }];
      }, 'startMs rosnąco');
      expectInvalid((m) => {
        narrationOf(m).cues = [{ text: 'A.', startMs: 0 }, { text: 'B.', startMs: 5000 }];
      }, 'nie później niż durationMs');
      expectInvalid((m) => {
        delete narrationOf(m).audioUrl;
        delete narrationOf(m).durationMs;
      }, 'cues wymaga nagrania');
      expectInvalid((m) => {
        narrationOf(m).cues = [];
      }, 'narration.cues');
      expectInvalid((m) => {
        narrationOf(m).cues = [{ text: 'A.', startMs: -1 }];
      }, 'narration.cues');
      expectInvalid((m) => {
        narrationOf(m).cues = [{ text: 'A.', startMs: 0, extra: 1 }];
      }, 'narration.cues');
      expectInvalid((m) => {
        narrationOf(m).cues = Array.from({ length: 50 }, (_, i) => ({ text: 'x'.repeat(1000), startMs: i }));
      }, 'łączna długość napisów');
    });
  });

  it('audioUrl bez durationMs (lub odwrotnie) jest błędem', () => {
    expectInvalid((m) => {
      delete (m.blocks[0].narration as Record<string, unknown>).durationMs;
    }, 'audioUrl i durationMs');
  });

  it('ilustracja hotspotów tylko względna, z rozszerzeniem graficznym', () => {
    expectInvalid((m) => {
      blockOf(m, 'SCENE_HOTSPOTS').image = 'https://evil.test/x.png';
    }, 'image');
  });

  it('QUIZ z opcją mającą i correct, i outcome, oraz bez poprawnej opcji', () => {
    expectInvalid((m) => {
      (blockOf(m, 'QUIZ').options[0] as Record<string, unknown>).outcome = 'wrong';
    }, 'dokładnie jedno z pól correct/outcome');
    expectInvalid((m) => {
      for (const option of blockOf(m, 'QUIZ').options) option.correct = false;
    }, 'brak poprawnej opcji');
  });

  it('wymagane identyfikatory muszą istnieć (hotspoty, pytania, zakładki)', () => {
    expectInvalid((m) => {
      blockOf(m, 'SCENE_HOTSPOTS').requiredHotspots = ['nie-ma'];
    }, 'nieznany identyfikator "nie-ma"');
    expectInvalid((m) => {
      blockOf(m, 'DIALOGUE').requiredQuestions = ['nie-ma'];
    }, 'nieznany identyfikator "nie-ma"');
    expectInvalid((m) => {
      blockOf(m, 'TABS').requiredTabs = ['nie-ma'];
    }, 'nieznany identyfikator "nie-ma"');
  });

  it('TEXT_INPUT_GUIDED: regex musi być kotwiczony ^...$, krótki i obsługiwany przez RE2 (bez backreferencji i lookahead)', () => {
    const withRegex = (regex: string) => (m: TestModule) => {
      blockOf(m, 'TEXT_INPUT_GUIDED').answer.regex = regex;
    };
    expectInvalid(withRegex('bank\\.pl'), '^...$');
    expectInvalid(withRegex('^bank\\.pl'), '^...$');
    expectInvalid(withRegex('bank\\.pl$'), '^...$');
    expectInvalid(withRegex('^bank\\.pl\\$'), '^...$'); // $ zapisany jako znak, nie kotwica
    expectInvalid(withRegex('^([$'), 'RE2');
    // Składnia, której RE2 nie kompiluje (czas liniowy): czytelny komunikat dla autora. Wzorce "katastrofalne" dla silnika z
    // nawrotem PRZECHODZĄ walidację, bo RE2 je obsłuży w czasie liniowym (regex.spec.ts pilnuje czasu).
    expectInvalid(withRegex('^([a-z]+)\\1$'), 'RE2'); // backreferencja
    expectInvalid(withRegex('^(?=a)a$'), 'RE2'); // lookahead
    expectInvalid(withRegex('^(?!a)b$'), 'RE2'); // negatywny lookahead
    expectInvalid(withRegex('^(?<=a)b$'), 'RE2'); // lookbehind
    expectInvalid(withRegex('^a)|(b$'), 'RE2'); // niezbalansowany nawias omijający kotwice po opakowaniu
    expectInvalid(withRegex(`^${'a'.repeat(200)}$`), 'answer.regex'); // za długi (limit 200)
    for (const ok of ['^bank\\.pl$', '^(bank|banki)\\.(pl|com)$', '^[a-z0-9-]+\\.pl$', '^(a|aa)+$', '^zażółć gęślą jaźń$']) {
      const module = fullModuleForTests();
      withRegex(ok)(module);
      expect(() => parseModule(module)).not.toThrow();
    }
  });

  it('ORDERING wymaga co najmniej 3 elementów, caseSensitive jest jawnym polem (domyślnie false)', () => {
    expectInvalid((m) => {
      blockOf(m, 'ORDERING').items = blockOf(m, 'ORDERING').items.slice(0, 2);
    }, 'items');
    const parsed = parseModule(fullModuleForTests());
    const text = parsed.blocks.find((b) => b.type === 'TEXT_INPUT_GUIDED') as Record<string, any>;
    expect(text.answer.caseSensitive).toBe(false);
  });

  it('TEXT_INPUT_GUIDED: niepoprawny regex, brak accept/regex, zbyt wiele podpowiedzi', () => {
    expectInvalid((m) => {
      blockOf(m, 'TEXT_INPUT_GUIDED').answer.regex = '^([$';
    }, 'answer.regex');
    expectInvalid((m) => {
      const t = blockOf(m, 'TEXT_INPUT_GUIDED');
      t.answer = {};
    }, 'wymagane accept albo regex');
    expectInvalid((m) => {
      blockOf(m, 'TEXT_INPUT_GUIDED').maxAttempts = 1;
    }, 'mniej niż maxAttempts');
  });

  it('ORDERING i EMAIL_ANALYSIS: powtórzone id elementów/kryteriów', () => {
    expectInvalid((m) => {
      blockOf(m, 'ORDERING').items[1].id = 'o1';
    }, 'powtórzony identyfikator "o1"');
    expectInvalid((m) => {
      blockOf(m, 'EMAIL_ANALYSIS').criteria[1].id = 'c1';
    }, 'powtórzony identyfikator "c1"');
  });

  it('SUMMARY musi być ostatni i jedyny', () => {
    expectInvalid((m) => {
      m.blocks.reverse();
    }, 'musi być ostatni');
    expectInvalid((m) => {
      m.blocks.push({ ...m.blocks[m.blocks.length - 1], id: 'podsumowanie-2' });
    }, 'co najwyżej jeden');
  });

  it('nieznany typ bloku, zła kategoria, zła wersja schematu', () => {
    expectInvalid((m) => {
      (m.blocks[0] as Record<string, unknown>).type = 'NOWY';
    }, 'blocks.0');
    expectInvalid((m) => {
      (m as Record<string, unknown>).category = 'INNA';
    }, 'category');
    expectInvalid((m) => {
      (m as Record<string, unknown>).schemaVersion = 1;
    }, 'schemaVersion');
  });
});

describe('withLegacyIds', () => {
  it('nadaje deterministyczne id b<indeks> i nie wywala się na śmieciach', () => {
    expect(withLegacyIds([{ type: 'VIDEO' }, null, 5, [1]])).toEqual([
      { type: 'VIDEO', id: 'b0' },
      { id: 'b1' },
      { id: 'b2' },
      { id: 'b3' },
    ]);
  });
});

describe('hashContent', () => {
  it('nie zależy od kolejności kluczy, zależy od treści', () => {
    expect(hashContent({ a: 1, b: { c: [1, 2], d: 2 } })).toBe(hashContent({ b: { d: 2, c: [1, 2] }, a: 1 }));
    expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 2 }));
    expect(hashContent([1, 2])).not.toBe(hashContent([2, 1]));
  });
});
