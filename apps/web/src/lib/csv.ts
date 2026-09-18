import { EMAIL_REGEX } from './email';
import { NAME_PATTERN } from './name-pattern';

// Ręcznie pisany parser CSV (RFC4180-ish), taki sam jak
// apps/api/src/users/csv.util.ts - celowo NIE współdzielony między
// apps/api/apps/web (różne runtime, tak jak reszta repo), ale identyczna
// logika. Używany WYŁĄCZNIE do natychmiastowego podglądu błędów w
// ImportCsvModal przed wysyłką - autorytatywna walidacja i tak dzieje się na
// backendzie (UsersService.importCsv), ten podgląd to tylko UX.
export function parseCsv(rawContent: string): string[][] {
  // BOM (Excel "CSV UTF-8") przed cudzysłowem nagłówka inaczej wyglądałby
  // jak "cudzysłów w środku pola".
  const content = rawContent.replace(/^\uFEFF/, '');
  // Polski Excel eksportuje CSV ze srednikiem - wykrywamy separator po pierwszej linii.
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function endField(): void {
    row.push(field);
    field = '';
  }

  function endRow(): void {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < content.length) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error('Nieprawidłowy format CSV: nieoczekiwany cudzysłów w polu');
      }
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new Error('Nieprawidłowy format CSV: niesparowany cudzysłów');
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}

const REQUIRED_COLUMNS = ['email', 'firstname', 'lastname'] as const;

export interface CsvPreviewRow {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  departmentName: string;
  error: string | null;
}

export interface CsvPreview {
  validRows: CsvPreviewRow[];
  invalidRows: CsvPreviewRow[];
  fileError: string | null;
}

// Sama walidacja formatu wierszy - NIE sprawdza duplikatów w bazie ani
// istniejących e-maili (to backend, patrz komentarz nad plikiem).
export function buildCsvPreview(content: string): CsvPreview {
  let rows: string[][];
  try {
    rows = parseCsv(content);
  } catch (error) {
    return { validRows: [], invalidRows: [], fileError: (error as Error).message };
  }

  if (rows.length === 0) {
    return { validRows: [], invalidRows: [], fileError: 'Plik CSV jest pusty.' };
  }

  const header = rows[0].map((column) => column.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    return {
      validRows: [],
      invalidRows: [],
      fileError: `Nagłówek CSV musi zawierać kolumny: email, firstName, lastName (departmentName opcjonalnie).`,
    };
  }

  const emailIdx = header.indexOf('email');
  const firstNameIdx = header.indexOf('firstname');
  const lastNameIdx = header.indexOf('lastname');
  const departmentNameIdx = header.indexOf('departmentname');

  const validRows: CsvPreviewRow[] = [];
  const invalidRows: CsvPreviewRow[] = [];

  rows.slice(1).forEach((columns, rowIndex) => {
    if (columns.every((column) => column.trim() === '')) {
      return;
    }

    const line = rowIndex + 2;
    const email = (columns[emailIdx] ?? '').trim();
    const firstName = (columns[firstNameIdx] ?? '').trim();
    const lastName = (columns[lastNameIdx] ?? '').trim();
    const departmentName = departmentNameIdx !== -1 ? (columns[departmentNameIdx] ?? '').trim() : '';

    let error: string | null = null;
    if (!EMAIL_REGEX.test(email)) {
      error = 'Nieprawidłowy format e-maila';
    } else if (!firstName || !lastName) {
      error = 'Brak imienia lub nazwiska';
    } else if (!NAME_PATTERN.test(firstName) || !NAME_PATTERN.test(lastName)) {
      error = 'Niedozwolone znaki w imieniu lub nazwisku';
    }

    const previewRow: CsvPreviewRow = { line, email, firstName, lastName, departmentName, error };
    (error ? invalidRows : validRows).push(previewRow);
  });

  return { validRows, invalidRows, fileError: null };
}

export const CSV_TEMPLATE = 'email,firstName,lastName,departmentName\n';
