import { compileAnswerRegex, validateRegex } from './node';

// RE2 dopasowuje w czasie liniowym: wzorce, które w silniku z nawrotem (V8) blokują proces na sekundy i minuty, tu kończą się
// natychmiast. To jedyna gwarancja przed ReDoS (walidacja wzorców heurystykami była niewystarczająca), więc test pilnuje CZASU
// na maksymalnej odpowiedzi (500 znaków: limit odpowiedzi w API).
describe('dopasowanie odpowiedzi silnikiem RE2', () => {
  const answer = `${'a'.repeat(499)}!`;

  it.each(['^a*a*a*a*a*a*$', '^((a|aa))+$', '^(a+)+$', '^(a|aa)+$', '^(.*a){20}$', '^([a-z]+)*$', '^(a*)*$'])(
    'wzorzec %s przechodzi walidację i dopasowanie maksymalnej odpowiedzi trwa < 50 ms',
    (pattern) => {
      expect(validateRegex(pattern)).toEqual([]);
      const regex = compileAnswerRegex(pattern);

      const started = process.hrtime.bigint();
      const result = regex.test(answer);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      expect(result).toBe(false);
      expect(elapsedMs).toBeLessThan(50);
    },
  );

  it('dopasowuje CAŁĄ odpowiedź, także dla alternatyw najwyższego poziomu (^a|b$)', () => {
    const regex = compileAnswerRegex('^(?:a)|(?:b)$');
    expect(regex.test('a')).toBe(true);
    expect(regex.test('b')).toBe(true);
    expect(regex.test('xb')).toBe(false);
    expect(regex.test('ax')).toBe(false);
  });

  it('domyślnie ignoruje wielkość liter (także polskie znaki), caseSensitive ją rozróżnia', () => {
    expect(compileAnswerRegex('^zażółć$').test('ZAŻÓŁĆ')).toBe(true);
    expect(compileAnswerRegex('^Bank$', true).test('bank')).toBe(false);
    expect(compileAnswerRegex('^Bank$', true).test('Bank')).toBe(true);
  });

  it.each([
    ['backreferencja', '^([a-z]+)\\1$'],
    ['lookahead', '^(?=a)a$'],
    ['negatywny lookahead', '^(?!a)b$'],
    ['lookbehind', '^(?<=a)b$'],
    ['niedomknięta klasa', '^[a-$'],
    ['niezbalansowany nawias omijający kotwice', '^a)|(b$'],
    ['nawias zamykający na początku', '^)a(|b$'],
  ])('walidacja odrzuca składnię nieobsługiwaną przez RE2: %s', (_label, pattern) => {
    const errors = validateRegex(pattern);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('RE2');
  });

  it('alternatywa najwyższego poziomu z ZBALANSOWANYMI nawiasami jest poprawna (i dopasowywana do całej odpowiedzi)', () => {
    expect(validateRegex('^a|b$')).toEqual([]);
    expect(compileAnswerRegex('^a|b$').test('xb')).toBe(false);
  });

  it('ten sam silnik w walidacji i w dopasowaniu: co przeszło walidację, kompiluje się przy dopasowaniu', () => {
    for (const pattern of ['^bank\\.pl$', '^(bank|banki)\\.(pl|com)$', '^[a-z0-9-]+\\.pl$']) {
      expect(validateRegex(pattern)).toEqual([]);
      expect(() => compileAnswerRegex(pattern)).not.toThrow();
      expect(() => compileAnswerRegex(pattern, true)).not.toThrow();
    }
  });
});
