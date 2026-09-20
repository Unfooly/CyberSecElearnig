import { extractSenderAddress, extractSenderDomain, extractTrackingTokens, maskTrackingTokens, normalizeSubject, sanitizePlainText, TOKEN_MASK } from './report-text';

const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'b-_'.repeat(14) + 'b'; // 43 znaki base64url
const TOKEN_C = 'C'.repeat(43);

describe('extractTrackingTokens / maskTrackingTokens', () => {
  it('znajduje tokeny z linków /t/<43 znaki>, bez duplikatów', () => {
    const text = `Kliknij https://firma.example/t/${TOKEN_A} lub http://x.test/t/${TOKEN_B}?a=1 oraz ponownie /t/${TOKEN_A}`;
    expect(TOKEN_B).toHaveLength(43);
    expect(extractTrackingTokens(text)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it('nie bierze za token ciągów za krótkich, za długich ani bez prefiksu /t/', () => {
    expect(extractTrackingTokens(`/t/${'A'.repeat(42)}`)).toEqual([]);
    expect(extractTrackingTokens(`/t/${'A'.repeat(44)}`)).toEqual([]);
    expect(extractTrackingTokens(`/x/${TOKEN_A}`)).toEqual([]);
    expect(extractTrackingTokens(TOKEN_A)).toEqual([]);
  });

  it('łączy wiele pól i ogranicza liczbę tokenów', () => {
    const many = Array.from({ length: 30 }, (_v, i) => `/t/${String(i).padStart(43, 'x')}`).join(' ');
    expect(extractTrackingTokens(many)).toHaveLength(10);
    expect(extractTrackingTokens('brak', undefined, null, `/t/${TOKEN_C}`)).toEqual([TOKEN_C]);
  });

  it('maskuje wszystkie tokeny i zostawia resztę tekstu', () => {
    const masked = maskTrackingTokens(`a https://f.test/t/${TOKEN_A} b /t/${TOKEN_B} c`);
    expect(masked).toBe(`a https://f.test${TOKEN_MASK} b ${TOKEN_MASK} c`);
    expect(masked).not.toContain(TOKEN_A);
    expect(extractTrackingTokens(masked)).toEqual([]);
  });
});

describe('zakodowane linki śledzące (Safe Links, encje, JSON, quoted-printable)', () => {
  const encoded: [string, string][] = [
    ['%2F (Safe Links / Proofpoint)', `https://safe.example/?url=https%3A%2F%2Ffirma.example%2Ft%2F${TOKEN_A}&data=1`],
    ['%2f małymi literami', `https%3a%2f%2ffirma.example%2ft%2f${TOKEN_A}`],
    ['encja HTML &#47;', `https:&#47;&#47;firma.example&#47;t&#47;${TOKEN_A}`],
    ['encja szesnastkowa &#x2F;', `firma.example&#x2F;t&#x2F;${TOKEN_A}`],
    ['JSON \\/', String.raw`{"url":"https:\/\/firma.example\/t\/${TOKEN_A}"}`],
    ['pełnoszerokie ukośniki (NFKC)', `https://firma.example／t／${TOKEN_A}`],
    ['miękkie łamanie quoted-printable w środku tokenu', `https://firma.example/t/${TOKEN_A.slice(0, 20)}=\n${TOKEN_A.slice(20)}`],
  ];

  it.each(encoded)('znajduje i maskuje token: %s', (_label, text) => {
    expect(extractTrackingTokens(text)).toEqual([TOKEN_A]);
    const masked = maskTrackingTokens(text);
    expect(masked).not.toContain(TOKEN_A);
    expect(masked).not.toContain(TOKEN_A.slice(0, 20));
    expect(masked).toContain(TOKEN_MASK);
  });

  it('tekst bez tokenu zostaje bez zmian (bez NFKC i sklejania łamań)', () => {
    const text = 'Pełna szerokość ＡＢＣ i koniec linii=\nkolejna linia';

    expect(maskTrackingTokens(text)).toBe(text);
  });

  it('wielokrotne wywołania są niezależne (brak stanu regexa z flagą g)', () => {
    const text = `https://f.example/t/${TOKEN_A}`;

    expect([maskTrackingTokens(text), maskTrackingTokens(text), maskTrackingTokens(text)]).toEqual(Array(3).fill(`https://f.example${TOKEN_MASK}`));
    expect(extractTrackingTokens(text)).toEqual(extractTrackingTokens(text));
  });
});

describe('sanitizePlainText', () => {
  it('usuwa NUL, znaki sterujące i nadpisania kierunku pisma, zachowuje nowe linie i tabulatory w tekście wielolinijkowym', () => {
    expect(sanitizePlainText('a\u0000b\u0007c‮d\r\ne\rf\tg​h', { multiline: true })).toBe('abcd\ne\nf\tgh');
  });

  it('w polu jednoliniowym zamienia znaki sterujące i nowe linie na spację', () => {
    expect(sanitizePlainText('Temat\nz\u0000  linią‮', { multiline: false })).toBe('Temat z linią');
  });

  it('normalizuje do NFC i przycina brzegi', () => {
    expect(sanitizePlainText('  é  ', { multiline: false })).toBe('é');
  });

  it('nie zmienia zawartości HTML (czysty tekst: brak interpretacji, wyświetlanie tylko jako tekst)', () => {
    expect(sanitizePlainText('<script>alert(1)</script>', { multiline: true })).toBe('<script>alert(1)</script>');
  });
});

describe('normalizeSubject', () => {
  it('zwija prefiksy odpowiedzi/przekazania, wielkość liter i białe znaki', () => {
    expect(normalizeSubject('RE: Fwd:  Odp: Twoja   PACZKA czeka')).toBe('twoja paczka czeka');
    expect(normalizeSubject('PD: Pilne')).toBe('pilne');
  });

  it('nie usuwa słów, które tylko wyglądają jak prefiks bez dwukropka', () => {
    expect(normalizeSubject('Reklamacja paczki')).toBe('reklamacja paczki');
    expect(normalizeSubject('Re Fwd: temat')).toBe('re fwd: temat');
  });

  it('porównuje formy NFKC (pełnoszerokie znaki)', () => {
    expect(normalizeSubject('ＰＡＣＺＫＡ')).toBe('paczka');
  });
});

describe('extractSenderDomain', () => {
  it('zwraca domenę małymi literami', () => {
    expect(extractSenderDomain('kurier@Powiadomienia.Example')).toBe('powiadomienia.example');
    expect(extractSenderDomain('a@sub.domena-x.example.com')).toBe('sub.domena-x.example.com');
  });

  it('zwraca null dla braku adresu i domen niepodobnych do nazwy domeny', () => {
    expect(extractSenderDomain(null)).toBeNull();
    expect(extractSenderDomain('kurier')).toBeNull();
    expect(extractSenderDomain('a@localhost')).toBeNull();
    expect(extractSenderDomain('a@-zla.example')).toBeNull();
    expect(extractSenderDomain('a@x_y.example')).toBeNull();
  });
});

describe('extractSenderAddress', () => {
  it('wyciąga adres z "Nazwa <adres>" i z samego adresu, małymi literami', () => {
    expect(extractSenderAddress('Kurier Ekspres <Kurier@Powiadomienia.Example>')).toBe('kurier@powiadomienia.example');
    expect(extractSenderAddress('  kurier@x.example ')).toBe('kurier@x.example');
  });

  it('zwraca null, gdy adresu nie da się wskazać jednoznacznie', () => {
    expect(extractSenderAddress('Kurier Ekspres')).toBeNull();
    expect(extractSenderAddress('kurier@x.example i inny@y.example')).toBeNull();
    expect(extractSenderAddress('')).toBeNull();
  });
});
