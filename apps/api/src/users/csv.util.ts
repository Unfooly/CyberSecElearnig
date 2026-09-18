// Ręcznie pisany parser CSV (RFC4180-ish: cudzysłowy, escapowane "" w polu,
// przecinki/nowe linie wewnątrz pola w cudzysłowie) - spójne z istniejącym
// wzorcem w tym repo (dashboard.service.ts ma ręczny toCsv/escapeCsvField
// zamiast biblioteki), nie nowa zależność runtime.
//
// Rzuca Error przy strukturalnie zepsutym pliku (niesparowany cudzysłów) -
// takiego pliku nie da się wiarygodnie podzielić na "dobre i złe wiersze",
// więc UsersService.importCsv odrzuca cały plik w takim przypadku, zamiast
// zgadywać.
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
  // \r\n, \r i \n wszystkie traktowane jako koniec wiersza - normalizujemy
  // przez pomijanie \r poza cudzysłowem zamiast osobnej obsługi każdego
  // wariantu.
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
        // Cudzysłów w środku niecudzysłowionego pola ("Jan"Kowalski) -
        // strukturalnie zepsuty plik, nie próbujemy zgadywać intencji.
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

  // Ostatni wiersz bez końcowego \n - domknij go, ale nie dodawaj sztucznego
  // pustego wiersza, jeśli plik kończy się już czystym \n.
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}
