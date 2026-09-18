import {
  buildMonthlyTrend,
  sortRows,
  summarizeUser,
  type SortableRow,
  type UserAssignmentInput,
} from './dashboard-metrics';

const d = (iso: string) => new Date(iso);

describe('buildMonthlyTrend', () => {
  const now = d('2026-09-18T12:00:00Z');

  it('zwraca 6 punktów, od najstarszego do bieżącego miesiąca', () => {
    const points = buildMonthlyTrend([], now);
    expect(points.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('miesiące bez żadnych przypisań mają completionRate=null (nie 0%)', () => {
    expect(buildMonthlyTrend([], now).every((p) => p.completionRate === null && p.mandatoryTotal === 0)).toBe(true);
  });

  it('liczy odsetek ukończonych na koniec każdego miesiąca (skumulowanie)', () => {
    const points = buildMonthlyTrend(
      [
        { createdAt: d('2026-05-10T00:00:00Z'), completedAt: d('2026-06-20T00:00:00Z') },
        { createdAt: d('2026-05-15T00:00:00Z'), completedAt: null },
      ],
      now,
    );
    const byMonth = Object.fromEntries(points.map((p) => [p.month, p]));

    expect(byMonth['2026-04'].completionRate).toBeNull();
    expect(byMonth['2026-05'].completionRate).toBe(0);
    expect(byMonth['2026-05'].mandatoryTotal).toBe(2);
    expect(byMonth['2026-06'].completionRate).toBe(50);
    expect(byMonth['2026-09'].completionRate).toBe(50);
  });

  it('przypisanie utworzone później nie zaniża wcześniejszych punktów trendu', () => {
    const points = buildMonthlyTrend(
      [
        { createdAt: d('2026-05-01T00:00:00Z'), completedAt: d('2026-05-02T00:00:00Z') },
        { createdAt: d('2026-09-01T00:00:00Z'), completedAt: null },
      ],
      now,
    );
    const byMonth = Object.fromEntries(points.map((p) => [p.month, p]));

    expect(byMonth['2026-06'].completionRate).toBe(100);
    expect(byMonth['2026-09'].completionRate).toBe(50);
  });

  it('ukończenie po końcu miesiąca nie wlicza się do tego miesiąca (granica: ostatnia ms)', () => {
    const points = buildMonthlyTrend(
      [{ createdAt: d('2026-05-01T00:00:00Z'), completedAt: d('2026-06-01T00:00:00.000Z') }],
      now,
    );
    const byMonth = Object.fromEntries(points.map((p) => [p.month, p]));

    expect(byMonth['2026-05'].completionRate).toBe(0);
    expect(byMonth['2026-06'].completionRate).toBe(100);
  });
});

describe('summarizeUser', () => {
  const now = d('2026-09-18T12:00:00Z');
  const base: UserAssignmentInput = {
    status: 'NOT_STARTED',
    dueDate: null,
    completedAt: null,
    updatedAt: d('2026-09-01T00:00:00Z'),
    mandatory: true,
  };

  it('brak obowiązkowych przypisań => NO_ASSIGNMENTS i procent null', () => {
    const summary = summarizeUser([{ ...base, mandatory: false }], now);
    expect(summary.complianceStatus).toBe('NO_ASSIGNMENTS');
    expect(summary.completionPercentage).toBeNull();
  });

  it('wszystkie obowiązkowe ukończone => COMPLIANT, 100%', () => {
    const summary = summarizeUser([{ ...base, status: 'COMPLETED' }, { ...base, status: 'COMPLETED' }], now);
    expect(summary.complianceStatus).toBe('COMPLIANT');
    expect(summary.completionPercentage).toBe(100);
  });

  it('świeżo przypisany, nieprzeterminowany kurs => IN_PROGRESS, nie "zaległości"', () => {
    const summary = summarizeUser([{ ...base, dueDate: d('2026-12-01T00:00:00Z') }], now);
    expect(summary.complianceStatus).toBe('IN_PROGRESS');
  });

  it('status OVERDUE albo termin w przeszłości bez ukończenia => OVERDUE', () => {
    expect(summarizeUser([{ ...base, status: 'OVERDUE' }], now).complianceStatus).toBe('OVERDUE');
    expect(summarizeUser([{ ...base, dueDate: d('2026-09-01T00:00:00Z') }], now).complianceStatus).toBe('OVERDUE');
  });

  it('ukończony kurs z terminem w przeszłości NIE jest zaległością', () => {
    const summary = summarizeUser([{ ...base, status: 'COMPLETED', dueDate: d('2026-01-01T00:00:00Z') }], now);
    expect(summary.complianceStatus).toBe('COMPLIANT');
  });

  it('liczy procent z obowiązkowych (opcjonalne pomija)', () => {
    const summary = summarizeUser(
      [
        { ...base, status: 'COMPLETED' },
        { ...base, status: 'IN_PROGRESS' },
        { ...base, status: 'COMPLETED', mandatory: false },
      ],
      now,
    );
    expect(summary.completedMandatoryCoursesCount).toBe(1);
    expect(summary.totalMandatoryCoursesCount).toBe(2);
    expect(summary.completionPercentage).toBe(50);
  });

  it('lastActivityAt ignoruje NOT_STARTED (samo przypisanie nie jest aktywnością) i bierze najnowszą zmianę', () => {
    const summary = summarizeUser(
      [
        { ...base, status: 'NOT_STARTED', updatedAt: d('2026-09-17T00:00:00Z') },
        { ...base, status: 'IN_PROGRESS', updatedAt: d('2026-08-01T00:00:00Z') },
        { ...base, status: 'COMPLETED', updatedAt: d('2026-09-05T00:00:00Z'), mandatory: false },
      ],
      now,
    );
    expect(summary.lastActivityAt).toEqual(d('2026-09-05T00:00:00Z'));
  });

  it('lastActivityAt = null, gdy nic nie zostało rozpoczęte', () => {
    expect(summarizeUser([base], now).lastActivityAt).toBeNull();
  });
});

describe('sortRows', () => {
  const row = (over: Partial<SortableRow>): SortableRow => ({
    firstName: null,
    lastName: null,
    email: 'x@test.pl',
    departmentName: null,
    completionPercentage: null,
    lastActivityAt: null,
    ...over,
  });

  it('sortuje po nazwisku z polskimi znakami i domyślnym fallbackiem na e-mail', () => {
    const rows = [
      row({ email: 'c@test.pl', lastName: 'Żak', firstName: 'A' }),
      row({ email: 'a@test.pl', lastName: 'Adamski', firstName: 'B' }),
      row({ email: 'b@test.pl' }),
    ];
    expect(sortRows(rows, 'name', 'asc').map((r) => r.email)).toEqual(['a@test.pl', 'b@test.pl', 'c@test.pl']);
  });

  it('sortuje po % ukończenia malejąco, brak danych (null) na końcu', () => {
    const rows = [
      row({ email: 'a@test.pl', completionPercentage: null }),
      row({ email: 'b@test.pl', completionPercentage: 20 }),
      row({ email: 'c@test.pl', completionPercentage: 90 }),
    ];
    expect(sortRows(rows, 'completion', 'desc').map((r) => r.email)).toEqual(['c@test.pl', 'b@test.pl', 'a@test.pl']);
  });

  it('sortuje po dziale, użytkownicy bez działu na końcu (asc)', () => {
    const rows = [
      row({ email: 'a@test.pl', departmentName: null }),
      row({ email: 'b@test.pl', departmentName: 'IT' }),
      row({ email: 'c@test.pl', departmentName: 'Finanse' }),
    ];
    expect(sortRows(rows, 'department', 'asc').map((r) => r.email)).toEqual(['c@test.pl', 'b@test.pl', 'a@test.pl']);
  });

  it('sortuje po ostatniej aktywności, brak aktywności jako najstarszy', () => {
    const rows = [
      row({ email: 'a@test.pl', lastActivityAt: null }),
      row({ email: 'b@test.pl', lastActivityAt: new Date('2026-09-01') }),
      row({ email: 'c@test.pl', lastActivityAt: new Date('2026-09-10') }),
    ];
    expect(sortRows(rows, 'lastActivity', 'desc').map((r) => r.email)).toEqual(['c@test.pl', 'b@test.pl', 'a@test.pl']);
  });

  it('remis rozstrzyga po e-mailu (stabilna paginacja) i nie mutuje wejścia', () => {
    const rows = [
      row({ email: 'b@test.pl', completionPercentage: 50 }),
      row({ email: 'a@test.pl', completionPercentage: 50 }),
    ];
    const sorted = sortRows(rows, 'completion', 'asc');
    expect(sorted.map((r) => r.email)).toEqual(['a@test.pl', 'b@test.pl']);
    expect(rows[0].email).toBe('b@test.pl');
  });
});
