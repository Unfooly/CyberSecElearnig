import { isEmail } from 'class-validator';
import { parseCsv } from '../csv.util';
import { NAME_PATTERN } from '../name-pattern';

// Import pracowników z CSV, krok 1 (podgląd): czyste funkcje bez bazy - dekodowanie pliku, wykrywanie separatora, mapowanie
// nagłówków (PL/EN) i walidacja wierszy. Testy: csv-import.spec.ts.

/** Limity importu (decyzja właściciela produktu 2026-09-20): 5000 wierszy danych i 1 MB. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_NAME_LENGTH = 100;
export const MAX_DEPARTMENT_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
/** Pole dłuższe niż to jest strukturalnie podejrzane (np. nieuciekany cudzysłów pochłaniający plik) - odrzucamy cały plik. */
const MAX_RAW_FIELD_LENGTH = 1000;

// BOM budowany z kodu (literał znaku w źródle bywa psuty przez edytory/narzędzia).
const BOM = String.fromCharCode(0xfeff);

/**
 * Dokładna ścieżka w Excelu (decyzja właściciela produktu 2026-09-20: to będzie najczęstszy błąd klientów). Zwykły typ "CSV
 * (rozdzielany przecinkami)" zapisuje plik w Windows-1250; potrzebny jest osobny typ "CSV UTF-8".
 */
export const EXCEL_UTF8_HINT =
  'W Excelu: Plik → Zapisz jako → w polu „Zapisz jako typ” wybierz „CSV UTF-8 (rozdzielany przecinkami)” (NIE zwykły „CSV (rozdzielany przecinkami)”), zapisz i wgraj ten plik ponownie.';

export class ImportFileError extends Error {}

const err = (message: string) => new ImportFileError(message);

/**
 * Bajty pliku -> tekst. Wymagany UTF-8 (z BOM albo bez). Odrzucamy z jasnym komunikatem: UTF-16 (BOM), pliki binarne (bajt NUL, np.
 * XLSX/ZIP) i tekst, który nie jest poprawnym UTF-8 (typowo Windows-1250 z polskiego Excela "CSV (rozdzielany przecinkami)") -
 * zgadywanie kodowania zepsułoby polskie znaki w imionach i nazwiskach, a te trafiają do maili z zaproszeniem.
 */
export function decodeImportFile(buffer: Buffer): string {
  if (buffer.length === 0) {
    throw err('Plik CSV jest pusty.');
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw err('Plik jest za duży (limit: 1 MB).');
  }
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)) {
    throw err(`Plik jest zapisany w kodowaniu UTF-16 (np. "Tekst Unicode"). ${EXCEL_UTF8_HINT}`);
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw err(`To wygląda na plik Excela (XLSX), a nie CSV. ${EXCEL_UTF8_HINT}`);
  }
  if (buffer.includes(0x00)) {
    throw err('To nie jest plik tekstowy CSV (zawiera dane binarne).');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw err(`Plik nie jest zapisany w kodowaniu UTF-8 (to typowe dla zwykłego "CSV" z polskiego Excela - Windows-1250 - przez co polskie znaki w imionach by się zepsuły). ${EXCEL_UTF8_HINT}`);
  }
}

const DELIMITERS = [',', ';', '\t'] as const;

/** Separator z pierwszej linii, liczony POZA cudzysłowami; wygrywa najczęstszy, remis = przecinek. */
export function detectDelimiter(content: string): string {
  const firstLine = (content.startsWith(BOM) ? content.slice(1) : content).split(/\r?\n/, 1)[0] ?? '';
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best: string = ',';
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) {
      best = delimiter;
    }
  }
  return best;
}

export type ImportColumn = 'email' | 'firstName' | 'lastName' | 'departmentName';

// Nagłówki po normalizacji (małe litery, bez polskich znaków i znaków innych niż litery/cyfry).
const HEADER_ALIASES: Record<ImportColumn, readonly string[]> = {
  email: ['email', 'mail', 'adresemail', 'emailaddress', 'adresmailowy'],
  firstName: ['firstname', 'imie', 'givenname', 'name'],
  lastName: ['lastname', 'nazwisko', 'surname', 'familyname'],
  departmentName: ['departmentname', 'department', 'dzial', 'dzialname', 'nazwadzialu'],
};

export const REQUIRED_COLUMNS: readonly ImportColumn[] = ['email', 'firstName', 'lastName'];

const COLUMN_LABELS: Record<ImportColumn, string> = {
  email: 'e-mail (email)',
  firstName: 'imię (firstName)',
  lastName: 'nazwisko (lastName)',
  departmentName: 'dział (departmentName)',
};

/** "Imię", "E-mail", "Dział" -> "imie", "email", "dzial". */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface ColumnMapping {
  indexes: Partial<Record<ImportColumn, number>>;
  /** Nagłówki, które nie pasują do żadnej kolumny (ignorowane, pokazywane w podglądzie). */
  ignored: string[];
}

export function mapHeader(header: readonly string[]): ColumnMapping {
  const indexes: Partial<Record<ImportColumn, number>> = {};
  const ignored: string[] = [];
  header.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    const column = (Object.keys(HEADER_ALIASES) as ImportColumn[]).find((key) => HEADER_ALIASES[key].includes(normalized));
    if (!column) {
      if (raw.trim()) ignored.push(raw.trim().slice(0, 60));
      return;
    }
    if (indexes[column] !== undefined) {
      throw err(`Nagłówek zawiera dwie kolumny oznaczające: ${COLUMN_LABELS[column]}.`);
    }
    indexes[column] = index;
  });
  const missing = REQUIRED_COLUMNS.filter((column) => indexes[column] === undefined);
  if (missing.length > 0) {
    throw err(`Brakuje wymaganych kolumn: ${missing.map((column) => COLUMN_LABELS[column]).join(', ')}. Nagłówki mogą być po polsku lub angielsku (dział jest opcjonalny).`);
  }
  return { indexes, ignored };
}

export interface ParsedImportRow {
  /** Numer wiersza w pliku (1 = nagłówek), zgodny z tym, co widzi użytkownik w arkuszu. */
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  /** null = wiersz poprawny; inaczej powód odrzucenia (bez zapisu). */
  error: string | null;
}

export interface ParsedImport {
  delimiter: string;
  ignoredColumns: string[];
  rows: ParsedImportRow[];
  /** Puste wiersze pominięte po cichu (np. końcowa pusta linia). */
  skippedEmpty: number;
}

// Nazwa działu trafia do bazy i do raportów CSV: bez znaków sterujących/formatujących i bez znaku formuły na początku
// (wstrzyknięcie formuły przy otwarciu raportu w Excelu - dodatkowo raport i tak escapuje komórki).
const DEPARTMENT_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FORMULA_START = /^[=+\-@|]/;

/**
 * Cały plik -> wiersze z walidacją per wiersz (bez przerywania na pierwszym błędzie). Błąd STRUKTURALNY (kodowanie, niesparowany
 * cudzysłów, brak wymaganych kolumn, zbyt wiele wierszy) rzuca ImportFileError - takiego pliku nie da się wiarygodnie podzielić na
 * dobre i złe wiersze. Adresy już istniejące w organizacji rozpoznaje dopiero serwis (wymaga bazy).
 */
export function parseImportFile(buffer: Buffer): ParsedImport {
  const content = decodeImportFile(buffer);
  const delimiter = detectDelimiter(content);
  let records: string[][];
  try {
    records = parseCsv(content, delimiter);
  } catch (error) {
    throw err((error as Error).message);
  }
  if (records.length === 0) {
    throw err('Plik CSV jest pusty.');
  }
  if (records.some((record) => record.some((field) => field.length > MAX_RAW_FIELD_LENGTH))) {
    throw err('Plik zawiera nieprawidłowo długie pole - sprawdź cudzysłowy w pliku.');
  }
  const mapping = mapHeader(records[0]);
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    throw err(`Plik zawiera zbyt wiele wierszy (limit: ${MAX_IMPORT_ROWS}). Podziel go na mniejsze pliki.`);
  }

  const rows: ParsedImportRow[] = [];
  const firstSeen = new Map<string, number>();
  let skippedEmpty = 0;
  dataRecords.forEach((record, index) => {
    const line = index + 2; // +1 nagłówek, +1 numeracja od 1
    if (record.every((field) => field.trim() === '')) {
      skippedEmpty += 1;
      return;
    }
    const cell = (column: ImportColumn) => (mapping.indexes[column] === undefined ? '' : (record[mapping.indexes[column] as number] ?? '').trim());
    const email = cell('email').toLowerCase();
    const firstName = cell('firstName').replace(/\s+/g, ' ');
    const lastName = cell('lastName').replace(/\s+/g, ' ');
    const departmentName = cell('departmentName').replace(/\s+/g, ' ');
    const error = validateRow({ email, firstName, lastName, departmentName }, record.length, mapping, line, firstSeen);
    if (!error && !firstSeen.has(email)) {
      firstSeen.set(email, line);
    }
    rows.push({
      line,
      email: email.slice(0, MAX_EMAIL_LENGTH),
      firstName: firstName.slice(0, MAX_NAME_LENGTH),
      lastName: lastName.slice(0, MAX_NAME_LENGTH),
      departmentName: departmentName ? departmentName.slice(0, MAX_DEPARTMENT_LENGTH) : null,
      error,
    });
  });
  return { delimiter, ignoredColumns: mapping.ignored, rows, skippedEmpty };
}

function validateRow(
  values: { email: string; firstName: string; lastName: string; departmentName: string },
  columnCount: number,
  mapping: ColumnMapping,
  line: number,
  firstSeen: Map<string, number>,
): string | null {
  const needed = Math.max(...(Object.values(mapping.indexes) as number[])) + 1;
  if (columnCount < needed && (!values.email || !values.firstName || !values.lastName)) {
    return 'Za mało kolumn w wierszu';
  }
  const { email, firstName, lastName, departmentName } = values;
  if (!email) return 'Brak adresu e-mail';
  if (email.length > MAX_EMAIL_LENGTH || firstName.length > MAX_NAME_LENGTH || lastName.length > MAX_NAME_LENGTH || departmentName.length > MAX_DEPARTMENT_LENGTH) {
    return 'Zbyt długa wartość w polu';
  }
  if (!isEmail(email, { allow_utf8_local_part: false })) return 'Nieprawidłowy format e-maila';
  if (!firstName || !lastName) return 'Brak imienia lub nazwiska';
  if (!NAME_PATTERN.test(firstName) || !NAME_PATTERN.test(lastName)) return 'Niedozwolone znaki w imieniu lub nazwisku';
  if (departmentName && (DEPARTMENT_FORBIDDEN.test(departmentName) || FORMULA_START.test(departmentName))) {
    return 'Niedozwolone znaki w nazwie działu (nie może zaczynać się od = + - @ ani zawierać znaków sterujących)';
  }
  const first = firstSeen.get(email);
  if (first !== undefined) return `Zduplikowany e-mail w tym pliku (pierwszy raz w wierszu ${first})`;
  void line;
  return null;
}
