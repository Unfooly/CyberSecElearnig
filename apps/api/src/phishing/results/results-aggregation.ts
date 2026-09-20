/**
 * Agregaty wyników symulacji per dział z PROGIEM MINIMALNEJ LICZEBNOŚCI: wynik grupy mniejszej niż MIN_GROUP_SIZE nie
 * jest pokazywany (w dziale 1-2 osobowym procent "kliknęło" identyfikowałby konkretne osoby).
 *
 * Sam próg to za mało: przy jednej ukrytej grupie jej wartości wynikałyby z różnicy "razem minus reszta". Dlatego grupy
 * poniżej progu są ŁĄCZONE w jeden wiersz "Pozostałe działy", a jeśli i on jest za mały, dokłada się do niego
 * najmniejszy widoczny dział, aż liczebność osiągnie próg. Każdy opublikowany wiersz (dział albo "Pozostałe") dotyczy
 * co najmniej MIN_GROUP_SIZE osób, więc żadnej pojedynczej małej grupy nie da się odjąć od sumy. Gdy cała organizacja
 * ma mniej osób niż próg, nie publikujemy nic ("za mało danych").
 *
 * Metryki zgłoszeń ("zgłosiło", "w tym po kliknięciu") to trzecia i czwarta liczba TEGO SAMEGO wiersza: podlegają
 * dokładnie tym samym grupom i progom (liczebność wiersza = osoby z dostarczoną wiadomością), więc nie tworzą nowych
 * granic grup. Zgłoszenia nie mają własnego progu - wiersz poniżej progu ukrywa wszystkie metryki naraz.
 *
 * CZYSTE funkcje - bez bazy, bez danych osobowych (wejście to fakty bez identyfikatorów osób).
 */

/** Minimalna liczba osób (z dostarczoną wiadomością) w grupie, żeby jej wynik był widoczny. */
export const MIN_GROUP_SIZE = 3;

/** Fakty o jednym odbiorcy bez identyfikatora osoby: tylko dział i wyniki. */
export interface RecipientFacts {
  departmentId: string | null;
  departmentName: string | null;
  sentAt: Date | null;
  clickedAt: Date | null;
  submittedAt: Date | null;
  /** Pierwsze zgłoszenie wiadomości jako podejrzanej (moduł zgłoszeń). */
  reportedAt: Date | null;
}

export interface GroupStats {
  delivered: number;
  clicked: number;
  submitted: number;
  /** Zgłosiło wiadomość jako podejrzaną (niezależnie od kliknięcia). */
  reported: number;
  /** W tym: zgłosiło PO kliknięciu (kliknęło, a potem zgłosiło) - podzbiór `reported` i `clicked`. */
  reportedAfterClick: number;
}

export type ResultRowKind = 'DEPARTMENT' | 'NO_DEPARTMENT' | 'OTHER' | 'ALL';

export interface ResultRow {
  kind: ResultRowKind;
  departmentId: string | null;
  name: string;
  /** true = za mało osób: liczby i procenty są null. */
  insufficientData: boolean;
  delivered: number | null;
  clicked: number | null;
  submitted: number | null;
  reported: number | null;
  reportedAfterClick: number | null;
  clickRate: number | null;
  submitRate: number | null;
  reportRate: number | null;
}

/**
 * Wiadomość uznajemy za dostarczoną, gdy dostawca ją przyjął albo odbiorca kliknął lub zgłosił ją (kliknięcie i zgłoszenie
 * dowodzą dostarczenia).
 */
export const isDelivered = (recipient: Pick<RecipientFacts, 'sentAt' | 'clickedAt' | 'reportedAt'>) =>
  recipient.sentAt !== null || recipient.clickedAt !== null || recipient.reportedAt !== null;

/** Zgłoszenie PO kliknięciu: kliknął, a zgłosił później (zgłoszenie przed kliknięciem to nie "po kliknięciu"). */
export const isReportedAfterClick = (recipient: Pick<RecipientFacts, 'clickedAt' | 'reportedAt'>) =>
  recipient.clickedAt !== null && recipient.reportedAt !== null && recipient.reportedAt.getTime() > recipient.clickedAt.getTime();

const emptyStats = (): GroupStats => ({ delivered: 0, clicked: 0, submitted: 0, reported: 0, reportedAfterClick: 0 });

function add(target: GroupStats, source: GroupStats): void {
  target.delivered += source.delivered;
  target.clicked += source.clicked;
  target.submitted += source.submitted;
  target.reported += source.reported;
  target.reportedAfterClick += source.reportedAfterClick;
}

/** Procent z jednym miejscem po przecinku; null, gdy mianownik 0. */
export function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

export function statsOf(recipients: readonly RecipientFacts[]): GroupStats {
  const stats = emptyStats();
  for (const recipient of recipients) {
    if (!isDelivered(recipient)) continue;
    stats.delivered += 1;
    if (recipient.clickedAt !== null) stats.clicked += 1;
    if (recipient.submittedAt !== null) stats.submitted += 1;
    if (recipient.reportedAt !== null) stats.reported += 1;
    if (isReportedAfterClick(recipient)) stats.reportedAfterClick += 1;
  }
  return stats;
}

const visibleRow = (kind: ResultRowKind, departmentId: string | null, name: string, stats: GroupStats): ResultRow => ({
  kind,
  departmentId,
  name,
  insufficientData: false,
  delivered: stats.delivered,
  clicked: stats.clicked,
  submitted: stats.submitted,
  reported: stats.reported,
  reportedAfterClick: stats.reportedAfterClick,
  clickRate: rate(stats.clicked, stats.delivered),
  submitRate: rate(stats.submitted, stats.delivered),
  reportRate: rate(stats.reported, stats.delivered),
});

const hiddenRow = (kind: ResultRowKind, departmentId: string | null, name: string): ResultRow => ({
  kind,
  departmentId,
  name,
  insufficientData: true,
  delivered: null,
  clicked: null,
  submitted: null,
  reported: null,
  reportedAfterClick: null,
  clickRate: null,
  submitRate: null,
  reportRate: null,
});

export const OTHER_DEPARTMENTS_LABEL = 'Pozostałe działy (za mało osób w pojedynczych działach)';
export const NO_DEPARTMENT_LABEL = 'Bez działu';
export const ALL_DEPARTMENTS_LABEL = 'Cała organizacja';

export interface Group {
  key: string;
  departmentId: string | null;
  name: string;
  stats: GroupStats;
}

export function groupByDepartment(recipients: readonly RecipientFacts[]): Group[] {
  const groups = new Map<string, Group & { members: RecipientFacts[] }>();
  for (const recipient of recipients) {
    const key = recipient.departmentId ?? '__none__';
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(recipient);
    } else {
      groups.set(key, {
        key,
        departmentId: recipient.departmentId,
        name: recipient.departmentId === null ? NO_DEPARTMENT_LABEL : (recipient.departmentName ?? NO_DEPARTMENT_LABEL),
        stats: emptyStats(),
        members: [recipient],
      });
    }
  }
  return [...groups.values()].map(({ members, ...group }) => ({ ...group, stats: statsOf(members) }));
}

/**
 * Wiersze wyników per dział z progiem i łączeniem małych grup (opis na górze pliku). Kolejność: działy widoczne
 * malejąco wg liczebności, potem "Pozostałe działy". Grupy bez żadnej dostarczonej wiadomości nie tworzą wierszy.
 */
export function departmentRows(recipients: readonly RecipientFacts[], min: number = MIN_GROUP_SIZE): ResultRow[] {
  return departmentRowsFromGroups(groupByDepartment(recipients), min);
}

/** Suma statystyk wszystkich grup (cała organizacja). */
export function totalStats(groups: readonly Group[]): GroupStats {
  const total = emptyStats();
  groups.forEach((group) => add(total, group.stats));
  return total;
}

/**
 * To samo co departmentRows, ale z GOTOWYCH statystyk grup (bez odbiorców): dzięki temu wynik można zapisać w pamięci
 * podręcznej jako same liczby per dział - bez żadnych danych o osobach (patrz ResultsSnapshotCache).
 */
export function departmentRowsFromGroups(allGroups: readonly Group[], min: number = MIN_GROUP_SIZE): ResultRow[] {
  const groups = allGroups.filter((group) => group.stats.delivered > 0).map((group) => ({ ...group, stats: { ...group.stats } }));
  const visible = groups.filter((group) => group.stats.delivered >= min);
  const small = groups.filter((group) => group.stats.delivered < min);

  const other = emptyStats();
  small.forEach((group) => add(other, group.stats));

  // Za mały wiersz zbiorczy: dokładamy najmniejszy widoczny dział, aż liczebność dojdzie do progu.
  visible.sort((a, b) => a.stats.delivered - b.stats.delivered);
  while (other.delivered > 0 && other.delivered < min && visible.length > 0) {
    add(other, (visible.shift() as Group).stats);
  }

  const rows = visible
    .sort((a, b) => b.stats.delivered - a.stats.delivered)
    .map((group) => visibleRow(group.departmentId === null ? 'NO_DEPARTMENT' : 'DEPARTMENT', group.departmentId, group.name, group.stats));
  if (other.delivered >= min) {
    rows.push(visibleRow('OTHER', null, OTHER_DEPARTMENTS_LABEL, other));
  } else if (other.delivered > 0) {
    // Cała organizacja poniżej progu: nie publikujemy żadnych liczb.
    rows.push(hiddenRow('ALL', null, ALL_DEPARTMENTS_LABEL));
  }
  return rows;
}

/** Wynik całej organizacji (KPI) albo pojedynczej grupy (np. dział kierownika): wartości tylko przy liczebności >= próg. */
export function summaryRow(kind: ResultRowKind, departmentId: string | null, name: string, recipients: readonly RecipientFacts[], min: number = MIN_GROUP_SIZE): ResultRow {
  return summaryRowFromStats(kind, departmentId, name, statsOf(recipients), min);
}

export function summaryRowFromStats(kind: ResultRowKind, departmentId: string | null, name: string, stats: GroupStats, min: number = MIN_GROUP_SIZE): ResultRow {
  return stats.delivered >= min ? visibleRow(kind, departmentId, name, stats) : hiddenRow(kind, departmentId, name);
}
