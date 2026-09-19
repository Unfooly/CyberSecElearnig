import { buildTrackingUrl, composePhishingMail, htmlToText } from './phishing-mail-composer';

const TOKEN = 'A'.repeat(43);
const URL_OK = `https://landing.example.net/t/${TOKEN}`;
// Separator linii Unicode budujemy z kodu (literał w źródle bywa psuty przez edytory/narzędzia).
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const TEMPLATE = {
  subject: 'Aktualizacja planu urlopów',
  bodyHtml: '<p>Cześć,</p><p>Potwierdź termin:</p><p><a href="{{trackingLink}}">Sprawdź i potwierdź</a></p><ul><li>a &amp; b</li></ul>',
  senderName: 'Dział HR',
  senderLocalPart: 'hr',
};

const compose = (overrides: Partial<typeof TEMPLATE> = {}, extra: Partial<{ senderDomain: string; trackingUrl: string; recipientEmail: string }> = {}) =>
  composePhishingMail({
    template: { ...TEMPLATE, ...overrides },
    recipientEmail: extra.recipientEmail ?? 'anna@firma.example.pl',
    trackingUrl: extra.trackingUrl ?? URL_OK,
    senderDomain: extra.senderDomain ?? 'symulacje.example.net',
  });

describe('buildTrackingUrl', () => {
  it('składa <baza>/t/<token>; ścieżka i zapytanie bazy są odrzucane (tylko origin)', () => {
    expect(buildTrackingUrl('https://landing.example.net', TOKEN, true)).toBe(URL_OK);
    expect(buildTrackingUrl('https://landing.example.net/kampanie?x=1', TOKEN, true)).toBe(URL_OK);
  });

  it('na produkcji wymaga https; poza produkcją dopuszcza http (dev)', () => {
    expect(() => buildTrackingUrl('http://landing.example.net', TOKEN, true)).toThrow(/https/);
    expect(buildTrackingUrl('http://localhost:3000', TOKEN, false)).toBe(`http://localhost:3000/t/${TOKEN}`);
    expect(() => buildTrackingUrl('ftp://x.example.net', TOKEN, false)).toThrow();
  });

  it.each(['', 'krótki', `${TOKEN}x`, `${'A'.repeat(42)}/`, `../${'A'.repeat(40)}`, `${'A'.repeat(42)}?`])('odrzuca nieprawidłowy token "%s"', (token) => {
    expect(() => buildTrackingUrl('https://landing.example.net', token, true)).toThrow(/token/i);
  });
});

describe('composePhishingMail', () => {
  it('nadawca: część lokalna z szablonu + ZAWSZE domena z konfiguracji; nazwa wyświetlana zachowana', () => {
    const message = compose();

    expect(message).toMatchObject({ fromEmail: 'hr@symulacje.example.net', fromName: 'Dział HR', toEmail: 'anna@firma.example.pl', subject: 'Aktualizacja planu urlopów' });
  });

  it('domeny nadawcy nie da się podać w części lokalnej (@ i inne znaki odrzucone)', () => {
    for (const local of ['hr@evil.example.com', 'HR', 'a..b', 'hr;bcc', 'hr ', '', 'a'.repeat(65)]) {
      expect(() => compose({ senderLocalPart: local })).toThrow(/część lokalna/i);
    }
  });

  it.each(['a@x.pl, b@y.pl', 'Ala <a@x.pl>', 'a@x.pl;b@y.pl', 'a@x.pl\r\nBcc: b@y.pl', 'a b@x.pl', 'a@@x.pl', 'brak-małpy', '', '@x.pl'])(
    'odrzuca adres odbiorcy "%s" (jeden adres, bez list/nazw/znaków sterujących)',
    (recipientEmail) => {
      expect(() => compose({}, { recipientEmail })).toThrow(/odbiorcy/i);
    },
  );

  it('nieprawidłowa domena nadawcy z konfiguracji => błąd (nic nie jest składane)', () => {
    for (const domain of ['', 'localhost', 'a b.example.net', 'evil.example.net>', '-x.example.net']) {
      expect(() => compose({}, { senderDomain: domain })).toThrow(/domena/i);
    }
  });

  it('placeholder {{trackingLink}} jest podmieniany na adres odbiorcy, a KAŻDY href w mailu to dokładnie ten adres', () => {
    const message = compose();

    const hrefs = [...message.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([URL_OK]);
    expect(message.html).not.toContain('{{trackingLink}}');
    expect(message.html).toContain('<meta charset="utf-8">');
  });

  it('treść z obcym linkiem (gdyby ominęła sanityzację) albo bez linku => błąd', () => {
    expect(() => compose({ bodyHtml: '<a href="https://evil.example.com">x</a><a href="{{trackingLink}}">y</a>' })).toThrow(/link/i);
    expect(() => compose({ bodyHtml: '<p>bez linku</p>' })).toThrow(/link/i);
    expect(() => compose({ bodyHtml: '<a href="javascript:alert(1)">x</a>' })).toThrow(/link/i);
  });

  it('adres w atrybucie jest escapowany (cudzysłowy, nawiasy kątowe nie wyrwą się z atrybutu)', () => {
    const message = compose({}, { trackingUrl: 'https://landing.example.net/t/x"onmouseover="alert(1)' });

    expect(message.html).not.toMatch(/href="[^"]*"onmouseover/);
    expect(message.html).toContain('&quot;');
  });

  it('temat: znaki sterujące i separatory linii zamieniane na spacje (nagłówek), długość ograniczona; nazwa nadawcy bez < > "', () => {
    const message = compose({ subject: `Temat\r\nBcc: ofiara@example.com${LINE_SEPARATOR}x`, senderName: 'HR <ceo@evil.example.com> "x"' });

    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject).not.toContain(LINE_SEPARATOR);
    expect(message.fromName).not.toMatch(/[<>"]/);
    expect(compose({ subject: 'a'.repeat(400) }).subject).toHaveLength(200);
  });

  it('wersja tekstowa: linki jako "tekst (adres)", akapity, listy, encje', () => {
    const { text } = compose();

    expect(text).toContain('Cześć,');
    expect(text).toContain(`Sprawdź i potwierdź (${URL_OK})`);
    expect(text).toContain('- a & b');
    expect(text).not.toMatch(/<[^>]+>/);
  });
});

describe('htmlToText', () => {
  it('nie zostawia znaczników i zwija puste linie', () => {
    expect(htmlToText('<p>a</p><p>b<br>c</p><ul><li>x</li><li>y</li></ul>')).toBe('a\n\nb\nc\n\n- x\n- y');
  });
});
