import { ContentValidationError, MODULE_SCHEMA_VERSION, requiredItemIds, withLegacyIds } from './index';
import { fullModule } from './fixtures';
import { hashContent, moduleWarnings, parseModule } from './node';

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

// Pola "śledztwa" (schemaVersion 3): dowody, required, kwestie dialogu, avatar.
describe('parseModule: schemaVersion 3 (dowody, required, lines)', () => {
  const invalid = (mutate: (m: TestModule) => void): string => {
    const module = fullModuleForTests();
    mutate(module);
    try {
      parseModule(module);
    } catch (e) {
      return (e as ContentValidationError).issues.join('\n');
    }
    return '';
  };
  const hotspots = (m: TestModule) => m.blocks.find((b) => b.type === 'SCENE_HOTSPOTS') as Record<string, any>;
  const dialogue = (m: TestModule) => m.blocks.find((b) => b.type === 'DIALOGUE') as Record<string, any>;
  const email = (m: TestModule) => m.blocks.find((b) => b.type === 'EMAIL_ANALYSIS') as Record<string, any>;

  it('fixtura v3 przechodzi; bieżąca wersja to 3', () => {
    expect(MODULE_SCHEMA_VERSION).toBe(3);
    expect(() => parseModule(fullModuleForTests())).not.toThrow();
  });

  it('migracja: moduł w wersji 2 bez pól z wersji 3 (stare requiredHotspots[]/requiredQuestions[], answer) nadal przechodzi', () => {
    const module = fullModuleForTests();
    module.schemaVersion = 2;
    const h = hotspots(module);
    for (const hotspot of h.hotspots) {
      delete hotspot.required;
      delete hotspot.evidence;
      delete hotspot.note;
    }
    const d = dialogue(module);
    delete d.character.avatar;
    d.questions = [
      { id: 'q1', text: 'Skąd ten mail?', answer: 'Rano.', note: { text: 'Mail przyszedł rano.' } },
      { id: 'q2', text: 'Kto go wysłał?', answer: 'Nie wiem.' },
    ];
    for (const criterion of email(module).criteria) {
      delete criterion.evidence;
      if (criterion.note) delete criterion.note.kind;
    }
    expect(() => parseModule(module)).not.toThrow();
  });

  it('moduł w wersji 2 z polami z wersji 3 jest odrzucony (każde pole nazwane w błędzie)', () => {
    const message = invalid((m) => {
      m.schemaVersion = 2;
    });
    for (const feature of ['hotspots[].evidence', 'hotspots[].required', 'questions[].lines', 'character.avatar', 'criteria[].evidence']) {
      expect(message).toContain(`pole ${feature} wymaga schemaVersion 3`);
    }
  });

  it('wersja spoza 2 i 3 jest odrzucona', () => {
    expect(invalid((m) => (m.schemaVersion = 4))).toContain('schemaVersion');
  });

  it('evidence bez note to błąd; evidence z note bez kind to błąd (każdy dowód ma ikonę)', () => {
    expect(invalid((m) => delete hotspots(m).hotspots[0].note)).toContain('hotspots[0]: evidence wymaga pola note');
    expect(invalid((m) => delete hotspots(m).hotspots[0].note.kind)).toContain('hotspots[0]: evidence wymaga note.kind');
    expect(invalid((m) => delete dialogue(m).questions[0].note.kind)).toContain('questions[0]: evidence wymaga note.kind');
    expect(invalid((m) => delete email(m).criteria[0].note.kind)).toContain('criteria[0]: evidence wymaga note.kind');
  });

  it('dowodem może być tylko kryterium maila oznaczone jako poprawne', () => {
    expect(
      invalid((m) => {
        email(m).criteria[1].evidence = true;
        email(m).criteria[1].note.kind = 'mail';
      }),
    ).toContain('criteria[1]: dowodem może być tylko kryterium poprawne');
  });

  it('nieznany rodzaj notatki jest odrzucony', () => {
    expect(invalid((m) => (hotspots(m).hotspots[0].note.kind = 'dragon'))).toContain('note.kind');
  });

  it('pytanie ma dokładnie jedno z answer / lines', () => {
    expect(invalid((m) => (dialogue(m).questions[0].answer = 'X'))).toContain('questions[0]: dokładnie jedno z pól answer / lines');
    expect(
      invalid((m) => {
        delete dialogue(m).questions[1].answer;
      }),
    ).toContain('questions[1]: dokładnie jedno z pól answer / lines');
  });

  it('required: co najmniej jeden element wymagany, gdy ustawiono je jawnie', () => {
    expect(
      invalid((m) => {
        hotspots(m).hotspots[0].required = false;
      }),
    ).toContain('hotspots: co najmniej jeden element musi mieć required: true');
  });

  it('avatar: tylko ścieżka względna do obrazu (jak inne zasoby)', () => {
    expect(invalid((m) => (dialogue(m).character.avatar = 'https://evil.test/a.png'))).toContain('character.avatar');
  });

  it('ostrzeżenia (nie błędy) o przestarzałych requiredHotspots[] / requiredQuestions[]', () => {
    const parsed = parseModule(fullModuleForTests());
    expect(moduleWarnings(parsed)).toEqual([
      expect.stringContaining('requiredHotspots[] jest przestarzałe'),
      expect.stringContaining('requiredQuestions[] jest przestarzałe'),
    ]);
    const dead = fullModuleForTests();
    hotspots(dead).hotspots[1].note = { text: 'Martwa notatka.', kind: 'place' };
    expect(moduleWarnings(parseModule(dead))).toContainEqual(expect.stringContaining('hotspots[1].note bez evidence'));
    const clean = fullModuleForTests();
    delete hotspots(clean).requiredHotspots;
    delete dialogue(clean).requiredQuestions;
    expect(moduleWarnings(parseModule(clean))).toEqual([]);
  });
});

describe('requiredItemIds (jedna reguła dla serwera i klienta)', () => {
  const items = [{ id: 'a' }, { id: 'b', required: true }, { id: 'c', required: false }];
  it('jawne required wygrywa ze starą listą i z domyślnym "wszystkie"', () => {
    expect(requiredItemIds(items, ['a', 'c'])).toEqual(['b']);
  });
  it('bez required: stara lista, a bez niej wszystkie; pusta stara lista = nic nie wymagane (jak na serwerze)', () => {
    const plain = [{ id: 'a' }, { id: 'b' }];
    expect(requiredItemIds(plain, ['b'])).toEqual(['b']);
    expect(requiredItemIds(plain)).toEqual(['a', 'b']);
    expect(requiredItemIds(plain, [])).toEqual([]);
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
