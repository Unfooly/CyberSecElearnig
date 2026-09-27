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

  it('hotspots[].media (B-086): dyskryminator kind musi być jednym z image/audio/document, każdy wariant strict i ze swoim rozszerzeniem pliku', () => {
    const media = (m: TestModule) => blockOf(m, 'SCENE_HOTSPOTS').hotspots[0].media;
    expectInvalid((m) => {
      media(m).kind = 'video';
    }, 'media');
    expectInvalid((m) => {
      media(m).extra = 'nieznane';
    }, 'media');
    expectInvalid((m) => {
      media(m).src = 'https://evil.test/x.png';
    }, 'media');
    expectInvalid((m) => {
      const audioHotspot = blockOf(m, 'SCENE_HOTSPOTS').hotspots[2];
      audioHotspot.media.audioUrl = 'audio/x.wav';
    }, 'media');
    expectInvalid((m) => {
      const documentHotspot = blockOf(m, 'SCENE_HOTSPOTS').hotspots[1];
      documentHotspot.media.lines = [];
    }, 'media');
  });

  it('hotspots[].action "next" (drzwi, B-086): nie może mieć content ani media; hotspot bez action wymaga content', () => {
    expectInvalid((m) => {
      // h5 to "drzwi" (action: 'next') w fixturze - bez content i media; dopisanie któregokolwiek jest błędem.
      const door = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.action === 'next');
      door.content = 'To nie powinno tu być.';
    }, 'action "next"');
    expectInvalid((m) => {
      const door = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.action === 'next');
      door.media = { kind: 'document', title: 'X', lines: ['x'] };
    }, 'action "next"');
    expectInvalid((m) => {
      // required:true na drzwiach byłoby ślepym zaułkiem - drzwi nigdy nie trafiają do `visited` same z siebie.
      const door = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.action === 'next');
      door.required = true;
    }, 'action "next"');
    expectInvalid((m) => {
      // Zwykły hotspot (action domyślne "card") bez content - dozwolone tylko dla "next".
      delete blockOf(m, 'SCENE_HOTSPOTS').hotspots[0].content;
    }, 'content jest wymagane');
  });

  it('hotspots[].media.kind "scene" (zagnieżdżona mini-scena, B-086): id unikalne w CAŁYM bloku (zewnętrzne + wewnętrzne), obszar i evidence/note jak zewnętrzne', () => {
    expectInvalid((m) => {
      // h4-outlook (wewnątrz zagnieżdżonej sceny h4) dostaje id już zajęte przez zewnętrzny hotspot h1.
      const nested = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.media?.kind === 'scene');
      nested.media.scene.hotspots[0].id = 'h1';
    }, 'powtórzony identyfikator');
    expectInvalid((m) => {
      const nested = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.media?.kind === 'scene');
      nested.media.scene.hotspots[0].width = 96; // x: 5 + width: 96 > 100
    }, 'obszar wychodzi poza obraz');
    expectInvalid((m) => {
      const nested = blockOf(m, 'SCENE_HOTSPOTS').hotspots.find((h: Record<string, any>) => h.media?.kind === 'scene');
      delete nested.media.scene.hotspots[0].note;
    }, 'evidence wymaga pola note');
  });

  it('requiredHotspots[] (przestarzałe) nie widzi id hotspotów WEWNĄTRZ zagnieżdżonej sceny - lista jest starsza niż zagnieżdżanie', () => {
    expectInvalid((m) => {
      blockOf(m, 'SCENE_HOTSPOTS').requiredHotspots = ['h4-outlook'];
    }, 'nieznany identyfikator "h4-outlook"');
  });

  it('scena z SAMYMI drzwiami (action:"next", bez innych hotspotów - np. "korytarz") przechodzi walidację: drzwi wykluczone z puli required, więc fallback "wszystkie" nie liczy ich samych', () => {
    const module = fullModuleForTests();
    const scene = blockOf(module, 'SCENE_HOTSPOTS');
    delete scene.requiredHotspots;
    scene.hotspots = [{ id: 'drzwi', label: 'Wyjście', x: 90, y: 5, width: 8, height: 10, action: 'next' }];
    expect(() => parseModule(module)).not.toThrow();
  });

  it('drzwi + INNY hotspot z required: false (bez required: true nigdzie): wykluczenie drzwi z puli nie maskuje błędu "brak required: true"', () => {
    const module = fullModuleForTests();
    const scene = blockOf(module, 'SCENE_HOTSPOTS');
    delete scene.requiredHotspots;
    scene.hotspots = [
      { id: 'dowod', label: 'Kartka', x: 10, y: 10, width: 20, height: 20, content: 'x', required: false },
      { id: 'drzwi', label: 'Wyjście', x: 90, y: 5, width: 8, height: 10, action: 'next' },
    ];
    let error: unknown;
    try {
      parseModule(module);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues.join('\n')).toContain('hotspots: co najmniej jeden element musi mieć required: true');
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

  it('fixtura przechodzi; bieżąca wersja to 5', () => {
    expect(MODULE_SCHEMA_VERSION).toBe(5);
    expect(() => parseModule(fullModuleForTests())).not.toThrow();
  });

  it('migracja: moduł w wersji 2 bez pól z wersji 3/4 (stare requiredHotspots[]/requiredQuestions[], answer) nadal przechodzi', () => {
    const module = fullModuleForTests();
    module.schemaVersion = 2;
    delete module.subtitle;
    delete module.level;
    delete module.objectives;
    // NARRATIVE (wersja 4) i BRIEFING (wersja 5) to CAŁE nowe typy, nie pojedyncze pola - w module w wersji 2 ich po prostu nie ma.
    module.blocks = module.blocks.filter((b) => b.type !== 'NARRATIVE' && b.type !== 'BRIEFING');
    for (const block of module.blocks) delete block.reactions;
    const h = hotspots(module);
    for (const hotspot of h.hotspots) {
      delete hotspot.required;
      delete hotspot.evidence;
      delete hotspot.note;
      // required/evidence/note są liczone na PŁASKIEJ liście (zewnętrzne + zagnieżdżone, semantics.ts) - trzeba je
      // usunąć też z hotspotów WEWNĄTRZ media.kind: 'scene', inaczej drugi required:false/evidence tam zostaje.
      if (hotspot.media?.kind === 'scene') {
        for (const inner of hotspot.media.scene.hotspots) {
          delete inner.required;
          delete inner.evidence;
          delete inner.note;
        }
      }
      // action/media (B-086) to funkcje wersji 4 - w module w wersji 2 ich po prostu nie ma; drzwi (action: 'next') bez
      // v4 wracają do zwykłej karty (jak w teście "wersja 3 bez pól z wersji 4" niżej).
      if (hotspot.action === 'next') hotspot.content = 'Zwykły hotspot bez akcji "next" (drzwi to funkcja wersji 4).';
      delete hotspot.action;
      delete hotspot.media;
    }
    const d = dialogue(module);
    delete d.character.avatar;
    delete d.character.opening;
    d.questions = [
      { id: 'q1', text: 'Skąd ten mail?', answer: 'Rano.', note: { text: 'Mail przyszedł rano.' } },
      { id: 'q2', text: 'Kto go wysłał?', answer: 'Nie wiem.' },
    ];
    delete email(module).email.date;
    delete email(module).email.attachment;
    delete email(module).email.to;
    for (const criterion of email(module).criteria) {
      delete criterion.evidence;
      delete criterion.target;
      if (criterion.note) delete criterion.note.kind;
    }
    expect(() => parseModule(module)).not.toThrow();
  });

  it('moduł w wersji 2 z polami z wersji 3 jest odrzucony (każde pole nazwane w błędzie)', () => {
    const message = invalid((m) => {
      m.schemaVersion = 2;
    });
    for (const feature of [
      'hotspots[].evidence',
      'hotspots[].required',
      'questions[].lines',
      'character.avatar',
      'criteria[].evidence',
      'criteria[].target',
      'email.date',
      'email.attachment',
    ]) {
      expect(message).toContain(`pole ${feature} wymaga schemaVersion 3`);
    }
  });

  it('wersja spoza 2-5 jest odrzucona', () => {
    expect(invalid((m) => (m.schemaVersion = 6))).toContain('schemaVersion');
  });

  it('evidence bez note to błąd', () => {
    expect(invalid((m) => delete hotspots(m).hotspots[0].note)).toContain('hotspots[0]: evidence wymaga pola note');
  });

  it('w wersji 3 każda notatka ma kind (także bez evidence), w wersji 2 nie ma go nigdzie', () => {
    expect(invalid((m) => delete hotspots(m).hotspots[0].note.kind)).toContain('hotspots[0]: note wymaga note.kind');
    expect(invalid((m) => delete dialogue(m).questions[0].note.kind)).toContain('questions[0]: note wymaga note.kind');
    expect(invalid((m) => delete email(m).criteria[0].note.kind)).toContain('criteria[0]: note wymaga note.kind');
    // Notatka bez evidence też: jedna reguła.
    expect(invalid((m) => delete email(m).criteria[1].note.kind)).toContain('criteria[1]: note wymaga note.kind');
  });

  it('dowodem może być tylko kryterium maila oznaczone jako poprawne', () => {
    expect(
      invalid((m) => {
        email(m).criteria[1].evidence = true;
        email(m).criteria[1].note.kind = 'mail';
      }),
    ).toContain('criteria[1]: dowodem może być tylko kryterium poprawne');
  });

  describe('kotwice kryteriów w makiecie maila (criteria[].target)', () => {
    const target = (m: TestModule, index: number, value: unknown) => {
      email(m).criteria[index].target = value;
    };

    it('poprawne kotwice wszystkich rodzajów przechodzą', () => {
      const module = fullModuleForTests();
      target(module, 0, { kind: 'subject' });
      target(module, 1, { kind: 'attachment' });
      target(module, 2, { kind: 'text', quote: 'Kliknij link' });
      expect(() => parseModule(module)).not.toThrow();
    });

    it.each([
      ['link do nieistniejącego linku', { kind: 'link', linkId: 'brak' }, 'link wymaga linkId istniejącego w email.links'],
      ['link bez linkId', { kind: 'link' }, 'link wymaga linkId'],
      ['cytat spoza treści', { kind: 'text', quote: 'tego nie ma w mailu' }, 'quote musi być fragmentem email.body'],
      ['text bez cytatu', { kind: 'text' }, 'quote musi być fragmentem email.body'],
      ['sender z quote', { kind: 'sender', quote: 'x' }, 'sender nie ma linkId ani quote'],
    ])('odrzuca: %s', (_label, value, fragment) => {
      expect(invalid((m) => target(m, 0, value))).toContain(fragment);
    });

    it('cytat z samych spacji jest odrzucony; ostrzeżenia: kotwice tylko przy poprawnych i cytat występujący wielokrotnie', () => {
      expect(invalid((m) => target(m, 0, { kind: 'text', quote: ' ' }))).toContain('quote musi być fragmentem email.body');

      const onlyCorrect = fullModuleForTests();
      target(onlyCorrect, 1, undefined); // c2 to jedyne błędne kryterium z kotwicą w fixturze
      expect(moduleWarnings(parseModule(onlyCorrect))).toContainEqual(expect.stringContaining('wszystkie kryteria z target są poprawne'));
      expect(moduleWarnings(parseModule(fullModuleForTests())).join('\n')).not.toContain('wszystkie kryteria z target');

      const repeated = fullModuleForTests();
      email(repeated).email.body = 'Kliknij link. Potem znów Kliknij.';
      const warnings = moduleWarnings(parseModule(repeated)).join('\n');
      expect(warnings).toContain('występuje w treści więcej niż raz');
    });

    it('attachment wymaga załącznika w mailu; dwa kryteria nie mogą mieć tej samej kotwicy', () => {
      expect(
        invalid((m) => {
          delete email(m).email.attachment;
          target(m, 0, { kind: 'attachment' });
        }),
      ).toContain('attachment wymaga email.attachment');
      expect(invalid((m) => target(m, 1, { kind: 'sender' }))).toContain('ta sama kotwica jest już użyta');
    });
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

// Pola "wersji 4": metadane modułu (subtitle/level/objectives), character.opening, reakcje maskotki (reactions), blok NARRATIVE.
describe('parseModule: schemaVersion 4 (metadane modułu, character.opening, reactions, NARRATIVE)', () => {
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
  const blockOf = (m: TestModule, type: string) => m.blocks.find((b) => b.type === type) as Record<string, any>;
  const quiz = (m: TestModule) => blockOf(m, 'QUIZ');
  const text = (m: TestModule) => blockOf(m, 'TEXT_INPUT_GUIDED');
  const dialogue = (m: TestModule) => blockOf(m, 'DIALOGUE');
  const email = (m: TestModule) => blockOf(m, 'EMAIL_ANALYSIS');

  it('moduł w wersji 3 z polami z wersji 4 jest odrzucony (każde pole/blok nazwane w błędzie)', () => {
    const message = invalid((m) => {
      m.schemaVersion = 3;
    });
    expect(message).toContain('subtitle: wymaga schemaVersion 4');
    expect(message).toContain('level: wymaga schemaVersion 4');
    expect(message).toContain('objectives: wymaga schemaVersion 4');
    expect(message).toContain('blok NARRATIVE wymaga schemaVersion 4');
    expect(message).toContain('pole character.opening wymaga schemaVersion 4');
    expect(message).toContain('pole reactions.complete wymaga schemaVersion 4');
    expect(message).toContain('pole reactions.result wymaga schemaVersion 4');
    expect(message).toContain('pole email.to wymaga schemaVersion 4');
    expect(message).toContain('pole hotspots[].action wymaga schemaVersion 4');
    expect(message).toContain('pole hotspots[].media wymaga schemaVersion 4');
  });

  it('moduł w wersji 3 bez pól z wersji 4 nadal przechodzi (migracja jak dla wersji 2)', () => {
    const module = fullModuleForTests();
    module.schemaVersion = 3;
    delete module.subtitle;
    delete module.level;
    delete module.objectives;
    module.blocks = module.blocks.filter((b: Record<string, any>) => b.type !== 'NARRATIVE' && b.type !== 'BRIEFING');
    for (const block of module.blocks) delete block.reactions;
    delete dialogue(module).character.opening;
    delete email(module).email.to;
    for (const hotspot of blockOf(module, 'SCENE_HOTSPOTS').hotspots) {
      // action: 'next' (drzwi) nie ma content - bez v4 drzwi nie istnieją, więc wraca do zwykłej karty (jak w wersji 3).
      if (hotspot.action === 'next') hotspot.content = 'Zwykły hotspot bez akcji "next" (drzwi to funkcja wersji 4).';
      delete hotspot.action;
      delete hotspot.media;
    }
    expect(() => parseModule(module)).not.toThrow();
  });

  it('reactions.result: dokładnie jedno z when/minScore (schemat)', () => {
    expect(
      invalid((m) => {
        quiz(m).reactions.result[0].when = 'correct';
      }),
    ).toContain('when/minScore');
    expect(
      invalid((m) => {
        delete text(m).reactions.result[0].when;
      }),
    ).toContain('when/minScore');
  });

  it('reactions.result na bloku bez wyniku (np. NOTEPAD) to błąd', () => {
    expect(
      invalid((m) => {
        blockOf(m, 'NOTEPAD').reactions = { result: [{ minScore: 0, pose: 'cheer', text: 'x' }] };
      }),
    ).toContain('reactions.result: nieprawidłowe dla bloku typu NOTEPAD');
  });

  it('TEXT_INPUT_GUIDED: reactions.result musi używać "when", nie "minScore"', () => {
    expect(
      invalid((m) => {
        const t = text(m);
        t.reactions.result = [{ minScore: 1, pose: 'cheer', text: 'x' }];
      }),
    ).toContain('dla TEXT_INPUT_GUIDED każdy wpis musi mieć "when"');
  });

  it('TEXT_INPUT_GUIDED: powtórzone "when" (dwa wpisy "correct") to błąd', () => {
    expect(
      invalid((m) => {
        text(m).reactions.result.push({ when: 'correct', pose: 'cheer', text: 'y' });
      }),
    ).toContain('powtórzone "when": "correct"');
  });

  it('QUIZ (i reszta ocenianych bez TEXT_INPUT_GUIDED): reactions.result musi używać "minScore", nie "when"', () => {
    expect(
      invalid((m) => {
        quiz(m).reactions.result = [{ when: 'correct', pose: 'cheer', text: 'x' }];
      }),
    ).toContain('dla QUIZ każdy wpis musi mieć "minScore"');
  });

  it('QUIZ: lista minScore musi być malejąca (pierwszy pasujący wpis wygrywa)', () => {
    expect(
      invalid((m) => {
        quiz(m).reactions.result = [
          { minScore: 0, pose: 'warning', text: 'x' },
          { minScore: 1, pose: 'cheer', text: 'y' },
        ];
      }),
    ).toContain('minScore musi być malejąca');
    expect(
      invalid((m) => {
        quiz(m).reactions.result = [
          { minScore: 0.5, pose: 'warning', text: 'x' },
          { minScore: 0.5, pose: 'cheer', text: 'y' },
        ];
      }),
    ).toContain('minScore musi być malejąca');
  });

  it('NARRATIVE: blok bez interakcji, tylko text (+ narration/mascot/reactions wspólne)', () => {
    const module = fullModuleForTests();
    const narrative = blockOf(module, 'NARRATIVE');
    expect(narrative.text).toEqual(expect.any(String));
    expect(() => parseModule(module)).not.toThrow();
  });

  it('NARRATIVE: w odróżnieniu od SUMMARY może wystąpić wielokrotnie i w DOWOLNYM miejscu (nie tylko na końcu)', () => {
    const module = fullModuleForTests();
    const narrative = blockOf(module, 'NARRATIVE');
    // Druga kopia (inny id) wstawiona na początek, a oryginał zostaje w środku - żadne z tych miejsc nie jest "końcem".
    module.blocks.unshift({ ...JSON.parse(JSON.stringify(narrative)), id: 'otwarcie-2' });
    expect(module.blocks.filter((b: Record<string, any>) => b.type === 'NARRATIVE')).toHaveLength(2);
    expect(() => parseModule(module)).not.toThrow();
  });
});

// Wersja 5: blok BRIEFING (odprawa) z zadaniami sprawy w kroku caseFile (tasks[] { id, text, completeWhen }), D-081.
describe('parseModule: schemaVersion 5 (BRIEFING, zadania sprawy)', () => {
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
  const briefing = (m: TestModule) => m.blocks.find((b) => b.type === 'BRIEFING') as Record<string, any>;
  const tasks = (m: TestModule) => briefing(m).steps.find((s: Record<string, any>) => s.kind === 'caseFile').tasks as Record<string, any>[];

  it('moduł w wersji 4 z blokiem BRIEFING jest odrzucony; bez niego przechodzi (cele to zawsze teksty)', () => {
    expect(invalid((m) => (m.schemaVersion = 4))).toContain('blok BRIEFING wymaga schemaVersion 5');
    const module = fullModuleForTests();
    module.schemaVersion = 4;
    module.blocks = module.blocks.filter((b) => b.type !== 'BRIEFING');
    expect(() => parseModule(module)).not.toThrow();
  });

  it('cele modułu (objectives) to wyłącznie teksty - obiekt z completeWhen jest odrzucony (zadania są w odprawie)', () => {
    expect(invalid((m) => (m.objectives[1] = { text: 'Cel', completeWhen: ['mail'] }))).toContain('objectives.1');
  });

  it('zadania sprawy: completeWhen z nieznanym blokiem, powtórzonym blokiem albo blokiem BRIEFING to błąd', () => {
    expect(invalid((m) => (tasks(m)[0].completeWhen = ['nie-ma']))).toMatch(/steps\[3\]\.tasks\[0\]\.completeWhen: nieznany blok "nie-ma"/);
    expect(invalid((m) => (tasks(m)[0].completeWhen = ['mail', 'mail']))).toContain('tasks[0].completeWhen: powtórzony blok "mail"');
    // "Pomiń odprawę" zalicza blok BRIEFING - gdyby odprawa odhaczała zadanie, pominięcie by je odhaczało.
    expect(invalid((m) => (tasks(m)[0].completeWhen = [briefing(m).id]))).toContain('blok odprawy (BRIEFING) nie może odhaczać zadań');
  });

  it('zadania sprawy: powtórzone id, pusta lista completeWhen i pole spoza schematu są odrzucone', () => {
    expect(invalid((m) => tasks(m).push({ ...tasks(m)[0] }))).toContain('tasks: powtórzony identyfikator "linki"');
    expect(invalid((m) => (tasks(m)[0].completeWhen = []))).toContain('tasks.0.completeWhen');
    expect(invalid((m) => delete tasks(m)[0].completeWhen)).toContain('tasks.0.completeWhen');
    expect(invalid((m) => (tasks(m)[0].done = true))).toContain('tasks.0');
  });

  it('BRIEFING: waga > 0 to błąd (blok nieoceniany zaniżałby wynik modułu)', () => {
    expect(invalid((m) => (briefing(m).weight = 1))).toContain('blok BRIEFING jest nieoceniany');
  });

  it('BRIEFING: mówca kroku call to wyłącznie postać { name, role, avatar } - maskotki w odprawie nie ma (schemat strict)', () => {
    expect(
      invalid((m) => {
        briefing(m).steps.find((s: Record<string, any>) => s.kind === 'call').caller.mascot = 'greeting';
      }),
    ).toContain('caller');
  });

  it('BRIEFING: nieznany rodzaj kroku to błąd schematu; krok start wymaga tekstu i przycisku', () => {
    expect(invalid((m) => (briefing(m).steps[0].kind = 'video'))).toContain('steps.0');
    expect(invalid((m) => delete briefing(m).steps.find((s: Record<string, any>) => s.kind === 'start').cta)).toContain('cta');
  });

  it('BRIEFING: krok badge nie przyjmuje danych gracza z treści (strict - imię liczy wyłącznie klient)', () => {
    expect(
      invalid((m) => {
        briefing(m).steps.find((s: Record<string, any>) => s.kind === 'badge').name = 'Jan K.';
      }),
    ).toContain('steps.4');
  });
});

// Wersja 5: rola głosu nagrania i nagranie media audio z potoku TTS (D-082).
describe('parseModule: schemaVersion 5 (voice, media.narration)', () => {
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
  const telefon = (m: TestModule) =>
    m.blocks.find((b) => b.type === 'SCENE_HOTSPOTS')!.hotspots.find((h: Record<string, any>) => h.media?.kind === 'audio');
  const toTts = (m: TestModule) => {
    const media = telefon(m).media;
    media.narration = { text: media.transcript, voice: 'bank' };
    delete media.audioUrl;
    delete media.transcript;
  };

  it('voice: znane role przechodzą (komisarz w odprawie fixtury), nieznana rola to błąd walidacji', () => {
    expect(() => parseModule(fullModuleForTests())).not.toThrow();
    expect(invalid((m) => (m.blocks[0].narration.voice = 'fooli'))).toContain('narration.voice');
    for (const voice of ['narrator', 'komisarz', 'bank', 'marek']) {
      expect(invalid((m) => (m.blocks[0].narration.voice = voice))).toBe('');
    }
    expect(invalid((m) => (m.blocks[0].narration.voice = 'lektor2'))).toContain('narration.voice');
  });

  it('media audio z nagraniem z potoku TTS (narration + voice) przechodzi; transkrypcją jest narration.text', () => {
    expect(invalid(toTts)).toBe('');
  });

  it('media audio: dokładnie jedno z audioUrl/narration, transcript tylko przy audioUrl', () => {
    expect(invalid((m) => (telefon(m).media.narration = { text: 'x' }))).toContain('dokładnie jednego z pól audioUrl/narration');
    expect(invalid((m) => delete telefon(m).media.audioUrl)).toContain('dokładnie jednego z pól audioUrl/narration');
    expect(invalid((m) => delete telefon(m).media.transcript)).toContain('audioUrl wymaga transcript');
    expect(
      invalid((m) => {
        toTts(m);
        telefon(m).media.transcript = 'druga kopia';
      }),
    ).toContain('bez transcript');
  });

  it('media audio w zagnieżdżonej scenie: te same reguły (dokładnie jedno z audioUrl/narration, transcript przy audioUrl)', () => {
    const nestedAudio = (m: TestModule) =>
      m.blocks
        .find((b) => b.type === 'SCENE_HOTSPOTS')!
        .hotspots.flatMap((h: Record<string, any>) => h.media?.scene?.hotspots ?? [])
        .find((h: Record<string, any>) => h.media?.kind === 'audio');
    const noTranscript = invalid((m) => delete nestedAudio(m).media.transcript);
    expect(noTranscript).toMatch(/hotspots\[\d+\]\.media\.scene\.hotspots\[\d+\]\.media: audioUrl wymaga transcript/);
    expect(invalid((m) => (nestedAudio(m).media.narration = { text: 'x' }))).toMatch(
      /media\.scene\.hotspots\[\d+\]\.media: audio wymaga dokładnie jednego z pól audioUrl\/narration/,
    );
    expect(
      invalid((m) => {
        const media = nestedAudio(m).media;
        media.narration = { text: media.transcript, voice: 'bank' };
        delete media.audioUrl;
        delete media.transcript;
      }),
    ).toBe('');
  });

  it('voice i media.narration w module w wersji 4 są odrzucone (nazwane w błędzie)', () => {
    const message = invalid((m) => {
      m.schemaVersion = 4;
      m.blocks = m.blocks.filter((b) => b.type !== 'BRIEFING');
      m.blocks[0].narration.voice = 'narrator';
      toTts(m);
    });
    expect(message).toContain('pole narration.voice wymaga schemaVersion 5');
    expect(message).toContain('pole media.narration wymaga schemaVersion 5');
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
