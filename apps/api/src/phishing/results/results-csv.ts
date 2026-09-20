/**
 * CSV wyników: RFC 4180 (cudzysłów podwajany, pola z przecinkiem/średnikiem/cudzysłowem/nową linią w cudzysłowie) oraz
 * OCHRONA PRZED WSTRZYKNIĘCIEM FORMUŁ (CSV injection): komórka zaczynająca się od = + - @ tab lub CR dostaje na początku
 * apostrof, żeby Excel/LibreOffice nie wykonał jej jako formuły (nazwy działów i imiona wpisują użytkownicy).
 * BOM UTF-8 na początku: Excel poprawnie odczytuje polskie znaki.
 */
// BOM budowany z kodu (literał znaku w źródle bywa psuty przez edytory/narzędzia).
const BOM = String.fromCharCode(0xfeff);
// Także po wiodących spacjach (" =CMD" bywa interpretowane jak formuła); "|" bywa operatorem DDE w starszych arkuszach.
const FORMULA_START = /^\s*[=+\-@|]|^[\t\r]/;

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [header, ...rows].map((line) => line.map(escapeCsvField).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
