// Szablon pliku importu (pobierany z kreatora): polskie nagłówki, średnik (Excel PL otwiera taki plik poprawnie), BOM UTF-8 -
// dzięki niemu Excel rozpoznaje kodowanie i polskie znaki w imionach nie psują się. BOM budowany z kodu (literał znaku w źródle
// bywa psuty przez edytory/narzędzia).
const BOM = String.fromCharCode(0xfeff);

export const IMPORT_TEMPLATE = `${BOM}E-mail;Imię;Nazwisko;Dział\r\njan.kowalski@firma.pl;Jan;Kowalski;Sprzedaż\r\nanna.nowak@firma.pl;Anna;Nowak;Księgowość\r\n`;
export const IMPORT_TEMPLATE_FILENAME = 'szablon-import-pracownikow.csv';

/** Limity importu (zgodne z API): 5000 wierszy i 1 MB. */
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 1024 * 1024;
