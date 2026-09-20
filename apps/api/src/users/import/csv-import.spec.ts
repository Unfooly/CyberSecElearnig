import { decodeImportFile, detectDelimiter, EXCEL_UTF8_HINT, ImportFileError, mapHeader, MAX_IMPORT_ROWS, normalizeHeader, parseImportFile } from './csv-import';

const BOM = String.fromCharCode(0xfeff);
const buf = (text: string) => Buffer.from(text, 'utf-8');

describe('decodeImportFile', () => {
  it('UTF-8 z BOM i bez BOM daje ten sam tekst, polskie znaki zachowane', () => {
    expect(decodeImportFile(buf('Zażółć,gęślą'))).toBe('Zażółć,gęślą');
    expect(decodeImportFile(buf(`${BOM}Zażółć`)).replace(BOM, '')).toBe('Zażółć');
  });

  it('odrzuca plik pusty i większy niż 1 MB', () => {
    expect(() => decodeImportFile(Buffer.alloc(0))).toThrow('pusty');
    expect(() => decodeImportFile(Buffer.alloc(1024 * 1024 + 1, 0x61))).toThrow('za duży');
    expect(() => decodeImportFile(Buffer.alloc(1024 * 1024, 0x61))).not.toThrow(); // dokładnie 1 MB jest dozwolone
  });

  it('odrzuca UTF-16 (BOM) z podpowiedzią, jak zapisać plik', () => {
    expect(() => decodeImportFile(Buffer.from([0xff, 0xfe, 0x65, 0x00]))).toThrow(/UTF-16.*CSV UTF-8/);
    expect(() => decodeImportFile(Buffer.from([0xfe, 0xff, 0x00, 0x65]))).toThrow(/UTF-16/);
  });

  it('odrzuca XLSX/ZIP (PK) i dane binarne (bajt NUL)', () => {
    expect(() => decodeImportFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]))).toThrow(/XLSX/);
    expect(() => decodeImportFile(Buffer.from('a,b\u0000c', 'utf-8'))).toThrow(/binarne/);
  });

  it('odrzuca Windows-1250 (typowy eksport polskiego Excela) zamiast zgadywać kodowanie i psuć polskie znaki', () => {
    // "Żółć" w Windows-1250: Ż=0xAF, ó=0xF3, ł=0xB3, ć=0xE6 - niepoprawny UTF-8.
    expect(() => decodeImportFile(Buffer.from([0x41, 0x2c, 0xaf, 0xf3, 0xb3, 0xe6]))).toThrow(/UTF-8.*Windows-1250/);
  });

  it('komunikat o kodowaniu pokazuje DOKŁADNĄ ścieżkę w Excelu (najczęstszy błąd klientów), także dla UTF-16 i XLSX', () => {
    const path = 'Plik → Zapisz jako → w polu „Zapisz jako typ” wybierz „CSV UTF-8 (rozdzielany przecinkami)” (NIE zwykły „CSV (rozdzielany przecinkami)”)';
    for (const bytes of [[0x41, 0x2c, 0xaf, 0xf3, 0xb3, 0xe6], [0xff, 0xfe, 0x65, 0x00], [0x50, 0x4b, 0x03, 0x04, 0x14]]) {
      expect(() => decodeImportFile(Buffer.from(bytes))).toThrow(EXCEL_UTF8_HINT);
      expect(EXCEL_UTF8_HINT).toContain(path);
    }
    expect(() => decodeImportFile(Buffer.from([0x41, 0x2c, 0xaf, 0xf3, 0xb3, 0xe6]))).toThrow(ImportFileError);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['email,firstName,lastName', ','],
    ['email;firstName;lastName', ';'],
    ['email\tfirstName\tlastName', '\t'],
    [`${BOM}E-mail;Imię;Nazwisko;Dział`, ';'],
    ['"a,b";c;d', ';'], // przecinek w cudzysłowie nie jest separatorem
    ['e-mail;imię;nazwisko,dział', ';'], // wygrywa częstszy
    ['jedna kolumna', ','], // brak separatora: przecinek
    ['a,b;c', ','], // remis: przecinek
  ])('%j => %j', (line, expected) => {
    expect(detectDelimiter(line)).toBe(expected);
  });
});

describe('normalizeHeader / mapHeader', () => {
  it('normalizuje polskie znaki, wielkość liter i znaki niealfanumeryczne', () => {
    expect(normalizeHeader('E-mail')).toBe('email');
    expect(normalizeHeader('  Imię ')).toBe('imie');
    expect(normalizeHeader('Dział')).toBe('dzial');
    expect(normalizeHeader('First Name')).toBe('firstname');
    expect(normalizeHeader('Adres e-mail')).toBe('adresemail');
    expect(normalizeHeader('Łódź')).toBe('lodz');
  });

  it.each([
    [['email', 'firstName', 'lastName', 'departmentName'], { email: 0, firstName: 1, lastName: 2, departmentName: 3 }],
    [['E-mail', 'Imię', 'Nazwisko', 'Dział'], { email: 0, firstName: 1, lastName: 2, departmentName: 3 }],
    [['Nazwisko', 'Imie', 'Adres e-mail'], { lastName: 0, firstName: 1, email: 2 }],
    [['Last Name', 'First Name', 'Mail', 'Department'], { lastName: 0, firstName: 1, email: 2, departmentName: 3 }],
  ])('nagłówki %j są mapowane (PL/EN, dowolna kolejność)', (header, expected) => {
    expect(mapHeader(header).indexes).toEqual(expected);
  });

  it('nieznane kolumny są ignorowane i zgłaszane; dział jest opcjonalny', () => {
    const mapping = mapHeader(['email', 'Telefon', 'firstName', 'lastName', 'Stanowisko', '']);

    expect(mapping.indexes).toEqual({ email: 0, firstName: 2, lastName: 3 });
    expect(mapping.ignored).toEqual(['Telefon', 'Stanowisko']);
  });

  it('brak wymaganej kolumny: komunikat wskazuje, czego brakuje (PL i EN)', () => {
    expect(() => mapHeader(['email', 'firstName'])).toThrow(/Brakuje wymaganych kolumn: nazwisko \(lastName\)/);
    expect(() => mapHeader(['foo', 'bar'])).toThrow(/e-mail \(email\), imię \(firstName\), nazwisko \(lastName\)/);
  });

  it('dwie kolumny o tym samym znaczeniu: błąd (nie zgadujemy, która jest właściwa)', () => {
    expect(() => mapHeader(['email', 'mail', 'imie', 'nazwisko'])).toThrow(/dwie kolumny.*e-mail/);
  });
});

describe('parseImportFile', () => {
  const file = (lines: string[], separator = '\n') => buf(lines.join(separator));

  it('poprawny plik EN z przecinkami: wiersze, numery linii (1 = nagłówek), e-mail małymi literami', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName,departmentName', 'Jan.Kowalski@Firma.PL,Jan,Kowalski,Sprzedaż', 'ewa@firma.pl,Ewa,Nowak,']));

    expect(parsed.delimiter).toBe(',');
    expect(parsed.rows).toEqual([
      { line: 2, email: 'jan.kowalski@firma.pl', firstName: 'Jan', lastName: 'Kowalski', departmentName: 'Sprzedaż', error: null },
      { line: 3, email: 'ewa@firma.pl', firstName: 'Ewa', lastName: 'Nowak', departmentName: null, error: null },
    ]);
  });

  it('polski plik ze średnikami, BOM-em i CRLF (eksport Excela CSV UTF-8)', () => {
    const parsed = parseImportFile(buf(`${BOM}E-mail;Imię;Nazwisko;Dział\r\nanna@firma.pl;Anna;Żółć;Księgowość\r\njan@firma.pl;Jan;Łęcki;\r\n`));

    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows.map((r) => [r.line, r.email, r.firstName, r.lastName, r.departmentName, r.error])).toEqual([
      [2, 'anna@firma.pl', 'Anna', 'Żółć', 'Księgowość', null],
      [3, 'jan@firma.pl', 'Jan', 'Łęcki', null, null],
    ]);
  });

  it('separator tabulatora; pola w cudzysłowie z separatorem i nową linią w środku', () => {
    const parsed = parseImportFile(buf('email\timie\tnazwisko\tdzial\nanna@firma.pl\tAnna\tKowalska\t"Dział A"\nbez@firma.pl\tJan\t"Nowak"\t"Dział\nB"\n'));

    expect(parsed.delimiter).toBe('\t');
    expect(parsed.rows[0]).toMatchObject({ email: 'anna@firma.pl', departmentName: 'Dział A', error: null });
    // Nowa linia wewnątrz pola w cudzysłowie zostaje częścią pola, a po zwinięciu białych znaków jest spacją.
    expect(parsed.rows[1]).toMatchObject({ line: 3, email: 'bez@firma.pl', departmentName: 'Dział B', error: null });
  });

  it('pomija puste wiersze (także końcowe) bez błędu, ale zachowuje numerację linii', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName', 'a@firma.pl,Anna,Nowak', '', ',,', 'b@firma.pl,Jan,Kowalski', '']));

    expect(parsed.skippedEmpty).toBe(2);
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 5]);
  });

  it('błędy per wiersz NIE przerywają pliku: każdy zły wiersz ma powód, dobre przechodzą', () => {
    const parsed = parseImportFile(
      file([
        'email,firstName,lastName,departmentName',
        'dobry@firma.pl,Anna,Nowak,IT', // 2
        'zly-email,Jan,Kowalski,IT', // 3
        'brak@imienia.pl,,Kowalski,IT', // 4
        'cyfry@firma.pl,J4n,Kowalski,IT', // 5
        `${'a'.repeat(250)}@firma.pl,Jan,Kowalski,IT`, // 6 zbyt długi
        ',Jan,Kowalski,IT', // 7 brak e-maila
        'formula@firma.pl,Jan,Kowalski,"=HYPERLINK(""http://x"")"', // 8
        'ok2@firma.pl,Ewa,Nowak,Dział',
      ]),
    );

    expect(parsed.rows.map((r) => [r.line, r.error])).toEqual([
      [2, null],
      [3, 'Nieprawidłowy format e-maila'],
      [4, 'Brak imienia lub nazwiska'],
      [5, 'Niedozwolone znaki w imieniu lub nazwisku'],
      [6, 'Zbyt długa wartość w polu'],
      [7, 'Brak adresu e-mail'],
      [8, expect.stringContaining('Niedozwolone znaki w nazwie działu')],
      [9, null],
    ]);
  });

  it.each(['=CMD()', '+48123', '-1', '@SUM(A1)', '|calc', `Dział${String.fromCharCode(7)}A`, `Dział${String.fromCharCode(0x202e)}A`])(
    'nazwa działu %j jest odrzucana (wstrzyknięcie formuły / znaki sterujące i formatujące)',
    (department) => {
      const parsed = parseImportFile(buf(`email,firstName,lastName,departmentName\na@firma.pl,Anna,Nowak,"${department.replace(/"/g, '""')}"\n`));

      expect(parsed.rows[0].error).toContain('nazwie działu');
    },
  );

  it.each(['=cmd|calc', 'Anna<script>', 'Jan; DROP TABLE users', 'Twoje konto zostanie zablokowane, kliknij tutaj 123'])(
    'imię %j (fraza phishingowa, znaczniki, cyfry) jest odrzucane allowlistą znaków',
    (firstName) => {
      const parsed = parseImportFile(buf(`email,firstName,lastName\na@firma.pl,"${firstName}",Nowak\n`));

      expect(parsed.rows[0].error).toBe('Niedozwolone znaki w imieniu lub nazwisku');
    },
  );

  it('duplikat e-maila w pliku (także w innej wielkości liter): pierwszy wiersz zostaje, kolejne mają błąd ze wskazaniem pierwszego', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName', 'jan@firma.pl,Jan,Kowalski', 'JAN@firma.pl,Jan,Inny', 'ewa@firma.pl,Ewa,Nowak', 'jan@firma.pl,Jan,Trzeci']));

    expect(parsed.rows.map((r) => [r.line, r.error])).toEqual([
      [2, null],
      [3, 'Zduplikowany e-mail w tym pliku (pierwszy raz w wierszu 2)'],
      [4, null],
      [5, 'Zduplikowany e-mail w tym pliku (pierwszy raz w wierszu 2)'],
    ]);
  });

  it('błędny wiersz nie "rezerwuje" adresu: poprawna kopia później nie jest duplikatem', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName', 'jan@firma.pl,,Kowalski', 'jan@firma.pl,Jan,Kowalski']));

    expect(parsed.rows.map((r) => r.error)).toEqual(['Brak imienia lub nazwiska', null]);
  });

  it('białe znaki: przycinanie i zwijanie wielokrotnych spacji w imieniu, nazwisku i dziale', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName,departmentName', '  a@firma.pl  ,  Anna   Maria ,  Nowak-Kowalska  ,  Dział   Główny ']));

    expect(parsed.rows[0]).toMatchObject({ email: 'a@firma.pl', firstName: 'Anna Maria', lastName: 'Nowak-Kowalska', departmentName: 'Dział Główny', error: null });
  });

  it('wiersz z mniejszą liczbą kolumn: "Za mało kolumn", gdy brakuje wymaganych wartości', () => {
    const parsed = parseImportFile(file(['email,firstName,lastName', 'a@firma.pl,Anna']));

    expect(parsed.rows[0].error).toBe('Za mało kolumn w wierszu');
  });

  it('limit 5000 wierszy: dokładnie 5000 przechodzi, 5001 odrzuca cały plik', () => {
    const make = (count: number) => file(['email,firstName,lastName', ...Array.from({ length: count }, (_v, i) => `u${i}@firma.pl,Anna,Nowak`)]);

    expect(parseImportFile(make(MAX_IMPORT_ROWS)).rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(() => parseImportFile(make(MAX_IMPORT_ROWS + 1))).toThrow(/zbyt wiele wierszy \(limit: 5000\)/);
  });

  it('błędy strukturalne odrzucają CAŁY plik z komunikatem: niesparowany cudzysłów, cudzysłów w środku pola, brak nagłówków', () => {
    expect(() => parseImportFile(buf('email,firstName,lastName\n"a@firma.pl,Anna,Nowak\n'))).toThrow(/cudzysłów/);
    expect(() => parseImportFile(buf('email,firstName,lastName\na@firma.pl,An"na,Nowak\n'))).toThrow(/cudzysłów/);
    expect(() => parseImportFile(buf('a@firma.pl,Anna,Nowak\n'))).toThrow(/Brakuje wymaganych kolumn/);
    expect(() => parseImportFile(buf('\n'))).toThrow();
  });

  it('pojedyncze pole dłuższe niż 1000 znaków to błąd pliku (nie wiersza): nieuciekany cudzysłów mógłby pochłonąć resztę', () => {
    expect(() => parseImportFile(buf(`email,firstName,lastName\na@firma.pl,"${'a'.repeat(1001)}",Nowak\n`))).toThrow(/nieprawidłowo długie pole/);
  });

  it('wszystkie wyjątki parsera to ImportFileError (kontroler zamienia je na 400 z komunikatem)', () => {
    for (const bad of [Buffer.alloc(0), buf('x'), Buffer.from([0xaf, 0xf3])]) {
      expect(() => parseImportFile(bad)).toThrow(ImportFileError);
    }
  });

  it('ignorowane kolumny są zwracane w wyniku', () => {
    const parsed = parseImportFile(file(['email,Telefon,firstName,lastName', 'a@firma.pl,123,Anna,Nowak']));

    expect(parsed.ignoredColumns).toEqual(['Telefon']);
    expect(parsed.rows[0].error).toBeNull();
  });
});
