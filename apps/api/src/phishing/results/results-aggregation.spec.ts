import { departmentRows, isDelivered, MIN_GROUP_SIZE, OTHER_DEPARTMENTS_LABEL, rate, RecipientFacts, statsOf, summaryRow } from './results-aggregation';
import { escapeCsvField, toCsv } from './results-csv';

const SENT = new Date('2027-01-01T10:00:00Z');
const CLICK = new Date('2027-01-01T11:00:00Z');

const REPORT_AFTER_CLICK = new Date('2027-01-01T12:00:00Z');
const REPORT_BEFORE_CLICK = new Date('2027-01-01T10:30:00Z');

/**
 * n odbiorców działu; pierwsi `clicked` kliknęli, pierwsi `submitted` wysłali formularz, `failed` bez dostarczenia.
 * `reported` = pierwsi tylu odbiorców zgłosiło wiadomość (osoby z pierwszej części listy, które też kliknęły, zgłosiły
 * PO kliknięciu; pozostałe bez kliknięcia).
 */
function dept(id: string | null, count: number, opts: { clicked?: number; submitted?: number; failed?: number; reported?: number } = {}): RecipientFacts[] {
  const { clicked = 0, submitted = 0, failed = 0, reported = 0 } = opts;
  return Array.from({ length: count }, (_v, index) => ({
    departmentId: id,
    departmentName: id === null ? null : `Dział ${id}`,
    sentAt: index < count - failed ? SENT : null,
    clickedAt: index < clicked ? CLICK : null,
    submittedAt: index < submitted ? CLICK : null,
    reportedAt: index < reported ? REPORT_AFTER_CLICK : null,
  }));
}

describe('progi minimalnej liczebności (agregaty per dział)', () => {
  it('działy >= progu są widoczne z liczbami i procentami, sortowane malejąco wg liczebności', () => {
    const rows = departmentRows([...dept('A', 4, { clicked: 1 }), ...dept('B', 10, { clicked: 5, submitted: 2 })]);

    expect(rows.map((row) => [row.name, row.delivered, row.clicked, row.submitted, row.clickRate, row.submitRate])).toEqual([
      ['Dział B', 10, 5, 2, 50, 20],
      ['Dział A', 4, 1, 0, 25, 0],
    ]);
    expect(rows.every((row) => !row.insufficientData)).toBe(true);
  });

  it('dział 1-2 osobowy NIGDY nie ma własnego wiersza z liczbami; jest łączony z resztą, a wiersz zbiorczy ma >= próg osób', () => {
    const rows = departmentRows([...dept('duży', 10, { clicked: 4 }), ...dept('mały', 2, { clicked: 2 }), ...dept('średni', 5, { clicked: 1 })]);

    expect(rows.find((row) => row.name === 'Dział mały')).toBeUndefined();
    const other = rows.find((row) => row.kind === 'OTHER');
    // 2 (mały) < 3, więc dokładamy najmniejszy widoczny dział (średni: 5) => 7 osób; z tego nie da się wyliczyć małego.
    expect(other).toMatchObject({ name: OTHER_DEPARTMENTS_LABEL, delivered: 7, clicked: 3 });
    expect(rows.map((row) => row.name)).toEqual(['Dział duży', OTHER_DEPARTMENTS_LABEL]);
  });

  it('brak możliwości odjęcia: suma opublikowanych wierszy = suma organizacji, a każdy wiersz ma >= próg osób (test losowy)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let round = 0; round < 300; round += 1) {
      const recipients: RecipientFacts[] = [];
      const departments = 1 + Math.floor(random() * 6);
      for (let d = 0; d < departments; d += 1) {
        const size = Math.floor(random() * 7);
        recipients.push(
          ...dept(`d${d}`, size, {
            clicked: Math.floor(random() * (size + 1)),
            reported: Math.floor(random() * (size + 1)),
            failed: Math.floor(random() * (size + 1) * 0.3),
          }),
        );
      }
      const totals = statsOf(recipients);
      const total = totals.delivered;

      const rows = departmentRows(recipients);

      const published = rows.filter((row) => !row.insufficientData);
      published.forEach((row) => expect(row.delivered as number).toBeGreaterThanOrEqual(MIN_GROUP_SIZE));
      if (total >= MIN_GROUP_SIZE) {
        expect(published.reduce((sum, row) => sum + (row.delivered as number), 0)).toBe(total);
        // Metryki zgłoszeń mają te same grupy i progi: suma opublikowanych wierszy = suma organizacji (nic nie da się odjąć).
        expect(published.reduce((sum, row) => sum + (row.reported as number), 0)).toBe(totals.reported);
        expect(published.reduce((sum, row) => sum + (row.reportedAfterClick as number), 0)).toBe(totals.reportedAfterClick);
      } else {
        expect(published).toEqual([]);
      }
    }
  });

  it('dwie małe grupy (2 + 1 osoba) tworzą razem widoczny wiersz zbiorczy bez dokładania działów', () => {
    const rows = departmentRows([...dept('duży', 6), ...dept('a', 2, { clicked: 1 }), ...dept('b', 1, { clicked: 1 })]);

    expect(rows.map((row) => [row.kind, row.delivered, row.clicked])).toEqual([
      ['DEPARTMENT', 6, 0],
      ['OTHER', 3, 2],
    ]);
  });

  it('cała organizacja poniżej progu: jeden wiersz "za mało danych" bez liczb', () => {
    const rows = departmentRows([...dept('a', 1, { clicked: 1 }), ...dept('b', 1)]);

    expect(rows).toEqual([expect.objectContaining({ kind: 'ALL', insufficientData: true, delivered: null, clicked: null, clickRate: null })]);
  });

  it('niedostarczone wiadomości nie liczą się do liczebności; kliknięcie dowodzi dostarczenia; grupa bez dostarczeń nie tworzy wiersza', () => {
    const facts: RecipientFacts[] = [
      ...dept('a', 5, { failed: 3 }), // dostarczono 2 => poniżej progu
      { departmentId: 'b', departmentName: 'Dział b', sentAt: null, clickedAt: CLICK, submittedAt: null, reportedAt: null }, // "niepewny", ale kliknął
      ...dept('c', 4, { failed: 4 }), // nic nie dostarczono
    ];

    expect(isDelivered(facts[5])).toBe(true);
    const rows = departmentRows(facts);
    // a: 2 dostarczone, b: 1 (kliknął mimo braku sentAt) => razem 3 = próg; c: 0 dostarczonych, więc bez własnego wiersza.
    expect(rows).toEqual([expect.objectContaining({ kind: 'OTHER', delivered: 3, clicked: 1 })]);
    expect(rows.some((row) => row.name.includes('Dział c'))).toBe(false);
  });

  it('odbiorcy bez działu tworzą własną grupę "Bez działu" podlegającą tym samym progom', () => {
    const rows = departmentRows([...dept(null, 4, { clicked: 2 }), ...dept('A', 5)]);

    expect(rows.map((row) => [row.kind, row.name, row.delivered])).toEqual([
      ['DEPARTMENT', 'Dział A', 5],
      ['NO_DEPARTMENT', 'Bez działu', 4],
    ]);
  });
});

describe('metryki zgłoszeń ("zgłosiło", "w tym po kliknięciu")', () => {
  it('liczy zgłoszenia i zgłoszenia po kliknięciu (podzbiór) oraz procent zgłaszalności z dostarczonych', () => {
    // 10 osób: 4 kliknęło, 6 zgłosiło; zgłoszenia pierwszych 4 (kliknęli) są PO kliknięciu, kolejne 2 bez kliknięcia.
    const rows = departmentRows(dept('A', 10, { clicked: 4, reported: 6 }));

    expect(rows[0]).toMatchObject({ delivered: 10, clicked: 4, reported: 6, reportedAfterClick: 4, reportRate: 60, clickRate: 40 });
  });

  it('zgłoszenie PRZED kliknięciem nie jest "po kliknięciu", ale jest zgłoszeniem', () => {
    const facts: RecipientFacts[] = Array.from({ length: 3 }, () => ({
      departmentId: 'A',
      departmentName: 'Dział A',
      sentAt: SENT,
      clickedAt: CLICK,
      submittedAt: null,
      reportedAt: REPORT_BEFORE_CLICK,
    }));

    expect(statsOf(facts)).toMatchObject({ clicked: 3, reported: 3, reportedAfterClick: 0 });
  });

  it('zgłoszenie dowodzi dostarczenia (jak kliknięcie): odbiorca bez sentAt, ale ze zgłoszeniem, liczy się do liczebności', () => {
    const facts: RecipientFacts = { departmentId: 'A', departmentName: 'Dział A', sentAt: null, clickedAt: null, submittedAt: null, reportedAt: REPORT_AFTER_CLICK };

    expect(isDelivered(facts)).toBe(true);
    expect(statsOf([facts])).toMatchObject({ delivered: 1, reported: 1, reportedAfterClick: 0 });
  });

  it('próg dotyczy zgłoszeń tak samo: dział 2-osobowy nie ujawnia zgłoszeń, a wiersz zbiorczy sumuje je z resztą', () => {
    const rows = departmentRows([...dept('duży', 10, { reported: 2 }), ...dept('mały', 2, { reported: 2 }), ...dept('średni', 5, { reported: 1 })]);

    expect(rows.find((row) => row.name === 'Dział mały')).toBeUndefined();
    // mały (2) + najmniejszy widoczny (średni: 5) = 7 osób, 3 zgłoszenia; z tego nie da się wyliczyć samego małego.
    expect(rows.find((row) => row.kind === 'OTHER')).toMatchObject({ delivered: 7, reported: 3, reportRate: 42.9 });
  });

  it('wiersz poniżej progu ukrywa WSZYSTKIE metryki, także zgłoszenia', () => {
    const rows = departmentRows(dept('a', 2, { clicked: 1, reported: 2 }));

    expect(rows).toEqual([expect.objectContaining({ kind: 'ALL', insufficientData: true, reported: null, reportedAfterClick: null, reportRate: null })]);
    expect(summaryRow('ALL', null, 'Org', dept('a', 2, { reported: 2 }))).toMatchObject({ insufficientData: true, reported: null, reportRate: null });
  });

  it('summaryRow od progu podaje zgłaszalność', () => {
    expect(summaryRow('ALL', null, 'Org', dept('a', 4, { reported: 1 }))).toMatchObject({ reported: 1, reportRate: 25 });
  });
});

describe('summaryRow (KPI organizacji, dział kierownika)', () => {
  it('poniżej progu: brak liczb; od progu: liczby i procenty', () => {
    const under = summaryRow('DEPARTMENT', 'A', 'Dział A', dept('A', 2, { clicked: 2 }));
    const over = summaryRow('DEPARTMENT', 'A', 'Dział A', dept('A', 3, { clicked: 1, submitted: 1 }));

    expect(under).toMatchObject({ insufficientData: true, delivered: null, clicked: null, clickRate: null });
    expect(over).toMatchObject({ insufficientData: false, delivered: 3, clicked: 1, clickRate: 33.3, submitRate: 33.3 });
  });

  it('próg liczy dostarczone, nie wszystkich odbiorców (5 odbiorców, 2 dostarczone => za mało)', () => {
    expect(summaryRow('ALL', null, 'Org', dept('A', 5, { failed: 3, clicked: 1 })).insufficientData).toBe(true);
  });
});

describe('rate', () => {
  it('zaokrągla do 0,1 pkt proc.; mianownik 0 => null', () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(2, 3)).toBe(66.7);
    expect(rate(0, 5)).toBe(0);
    expect(rate(0, 0)).toBeNull();
  });
});

describe('CSV', () => {
  it.each([
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
    ['+48 600 100 200', "'+48 600 100 200"],
    ['-5', "'-5"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['  =CMD()', "'  =CMD()"],
    ['|calc', "'|calc"],
  ])('komórka tekstowa "%s" jest chroniona przed formułą', (input, expected) => {
    const escaped = escapeCsvField(input);

    expect(escaped.replace(/^"|"$/g, '').replace(/""/g, '"')).toBe(expected);
  });

  it('liczby ujemne jako liczby nie są ruszane; null/undefined => puste; cudzysłów, przecinek i nowa linia są cytowane', () => {
    expect(escapeCsvField(-5)).toBe('-5');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('powiedział "cześć"')).toBe('"powiedział ""cześć"""');
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
  });

  it('toCsv: BOM UTF-8, CRLF, nagłówek i wiersze', () => {
    const csv = toCsv(['Dział', 'Liczba'], [['Sprzedaż', 5], ['=x', 1]]);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe("Dział,Liczba\r\nSprzedaż,5\r\n'=x,1\r\n");
  });
});
