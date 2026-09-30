import { ContentValidationError, toClientBlock } from './index';
import { fullModule, fullModuleV6 } from './fixtures';
import { noteItemsOf, parseModule } from './node';

// Przesłuchanie (D-118, moduł 2 faza 1c): kwestie-fragmenty do notatnika, sprzeczność obalana dowodem z wcześniejszego bloku, konsola.

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
const interrogation = (m: AnyModule) => m.blocks.find((b: AnyModule) => b.type === 'INTERROGATION');
const line = (m: AnyModule, lineId: string) =>
  interrogation(m)
    .questions.flatMap((q: AnyModule) => q.lines)
    .find((l: AnyModule) => l.id === lineId);

describe('INTERROGATION: walidacja', () => {
  it('fixtura v6 przechodzi', () => {
    expect(errorsOf(fullModuleV6())).toBe('');
  });

  it('blok wymaga schemaVersion 6', () => {
    const m = fullModule() as AnyModule;
    const block = interrogation(fullModuleV6());
    // Bez ról głosu v6 i sprzeczności (dowód nagrania jest tylko w v6) - zostaje sam wymóg wersji bloku.
    for (const question of block.questions) for (const l of question.lines) {
      delete l.narration;
      delete l.contradiction;
    }
    for (const row of block.documents[0].rows) if (row.note) row.note.kind = 'item';
    m.blocks.splice(m.blocks.length - 1, 0, block);
    expect(errorsOf(m)).toContain('blok INTERROGATION wymaga schemaVersion 6');
  });

  it('refutedBy: dowód (evidence z notatką) z WCZEŚNIEJSZEGO bloku, w formacie <blok>.<element>', () => {
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'nagranie.nie-ma')))).toContain('"nagranie.nie-ma" nie jest dowodem');
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'podsumowanie.x')))).toContain('blok "podsumowanie" musi być WCZEŚNIEJ');
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'przesluchanie.glos-1')))).toContain('musi być WCZEŚNIEJ');
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'bez-kropki')))).toContain('klucz dowodu w postaci');
    // Zwykła linijka teczki (bez evidence) nie jest dowodem.
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'akta.w1')))).toContain('"akta.w1" nie jest dowodem');
    // Dowód z teczki (wcześniejszy blok) - poprawny.
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.refutedBy = 'akta.w2')))).toBe('');
  });

  it('kwestia: fragment ALBO sprzeczność; fragment-dowód z notatką; głos postaci przy nagraniu', () => {
    expect(
      errorsOf(mutate((m) => (line(m, 'kod-1').fragment = { evidence: true, note: { text: 'X', kind: 'person' } }))),
    ).toContain('fragmentem do notatnika ALBO sprzecznością');
    expect(errorsOf(mutate((m) => delete line(m, 'glos-1').fragment.note.kind))).toContain('note wymaga note.kind');
    expect(errorsOf(mutate((m) => delete line(m, 'glos-1').narration.voice))).toContain('kwestia postaci wymaga roli głosu');
    // Kwestia po podważeniu to sam tekst (sekret - bez nagrania w publicznym magazynie).
    expect(errorsOf(mutate((m) => (line(m, 'kod-1').contradiction.challengeLine.narration = { text: 'x' })))).toContain('challengeLine');
  });

  it('id kwestii, dokumentów i wierszy konsoli w jednej przestrzeni; id pytań unikalne', () => {
    expect(errorsOf(mutate((m) => (line(m, 'glos-2').id = 'l1')))).toContain('lines/documents/rows: powtórzony identyfikator "l1"');
    expect(errorsOf(mutate((m) => (interrogation(m).questions[1].id = 'glos')))).toContain('questions: powtórzony identyfikator "glos"');
  });

  it('konsola: dokładnie jedno pytanie z opensDocuments przy documents, żadne bez nich; wiersze jak w teczce', () => {
    expect(errorsOf(mutate((m) => delete interrogation(m).questions[2].opensDocuments))).toContain('dokładnie jedno pytanie z opensDocuments');
    expect(errorsOf(mutate((m) => (interrogation(m).questions[0].opensDocuments = true)))).toContain('dokładnie jedno pytanie z opensDocuments');
    expect(errorsOf(mutate((m) => delete interrogation(m).documents))).toContain('opensDocuments bez documents');
    expect(errorsOf(mutate((m) => interrogation(m).documents[0].rows[0].cells.push('nadmiar')))).toContain('liczba komórek (3) różna od liczby kolumn (2)');
    expect(errorsOf(mutate((m) => (interrogation(m).documents[0].rows[0].required = true)))).toContain('required dotyczy wyłącznie wierszy-dowodów');
  });

  it('reakcje na wynik tylko przy wyniku; wymagany wiersz konsoli wymaga wymaganego pytania konsoli', () => {
    expect(errorsOf(mutate((m) => (interrogation(m).weight = 0)))).toContain('przesłuchanie bez wyniku');
    expect(
      errorsOf(
        mutate((m) => {
          interrogation(m).questions.forEach((q: AnyModule) => (q.required = q.id !== 'konsola'));
        }),
      ),
    ).toContain('wymagane wiersze konsoli wymagają wymaganego pytania konsoli ("konsola")');
  });

  it('bez sprzeczności nieoceniane: waga > 0 to błąd, waga 0 przechodzi', () => {
    const withoutContradiction = (m: AnyModule) => {
      const kod = interrogation(m).questions[1];
      kod.lines = [{ id: 'kod-1', text: 'Nie podawałem kodów.' }];
      delete interrogation(m).reactions.result;
    };
    expect(errorsOf(mutate((m) => { withoutContradiction(m); interrogation(m).weight = 1; }))).toContain('przesłuchanie bez sprzeczności jest nieoceniane');
    expect(errorsOf(mutate((m) => { withoutContradiction(m); interrogation(m).weight = 0; }))).toBe('');
  });
});

describe('INTERROGATION: noteItemsOf i projekcja', () => {
  it('notatki: fragmenty, sprzeczność (dowód po podważeniu), wiersze konsoli - zwykła kwestia bez notatki', () => {
    const block = interrogation(fullModuleV6());
    // Sprzeczność - dowód ukryty do zebrania (hidden): które kwestie kłamią, klient nie wie; ich liczba jest w sumie licznika (D-130).
    expect(noteItemsOf(block).map((item) => [item.id, item.evidence === true, item.hidden === true])).toEqual([
      ['glos-1', true, false],
      ['kod-1', true, true],
      ['l1', false, false],
      ['l2', true, false],
    ]);
  });

  it('toClientBlock: kwestie, fragmenty i konsola są, sprzeczności nie ma (ani śladu, która kwestia kłamie)', () => {
    const block = toClientBlock(interrogation(fullModuleV6()), { shuffleSeed: () => [1, 2, 3, 4], opaqueId: (b, i) => `${b}-${i}` }) as AnyModule;
    const kod = block.questions[1].lines[0];
    expect(kod).toEqual({ id: 'kod-1', text: 'Nie, żadnych kodów.', narration: expect.objectContaining({ text: expect.any(String) }) });
    expect(block.questions[0].lines[0].fragment).toEqual({ evidence: true, note: { text: 'Karol rozpoznał głos.', kind: 'person' } });
    expect(block.documents[0].rows.map((r: AnyModule) => r.id)).toEqual(['l1', 'l2']);
    expect(JSON.stringify(block)).not.toContain('contradiction');
  });
});
