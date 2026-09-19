import { mailLimiterKey, RegistrationMailLimiter } from './registration-mail-limiter';

describe('mailLimiterKey', () => {
  it.each([
    ['Ofiara@Firma.pl', 'ofiara@firma.pl'],
    ['ofiara+1@firma.pl', 'ofiara@firma.pl'],
    ['ofiara+abc+def@firma.pl', 'ofiara@firma.pl'],
    ['  ofiara+x@firma.pl ', 'ofiara@firma.pl'],
    ['inna+1@firma.pl', 'inna@firma.pl'],
    ['brak-malpy', 'brak-malpy'],
  ])('%s => %s', (input, expected) => {
    expect(mailLimiterKey(input)).toBe(expected);
  });

  it('alias "+" w domenie nie jest obcinany (tylko część lokalna)', () => {
    expect(mailLimiterKey('a@fi+rma.pl')).toBe('a@fi+rma.pl');
  });
});

describe('RegistrationMailLimiter', () => {
  it('aliasy "+tag" tej samej skrzynki dzielą limit', () => {
    const limiter = new RegistrationMailLimiter();

    expect(limiter.tryAcquire('ofiara+1@firma.pl', 1000)).toBe(true);
    expect(limiter.tryAcquire('ofiara+2@firma.pl', 1001)).toBe(false);
    expect(limiter.tryAcquire('ofiara@firma.pl', 1002)).toBe(false);
  });

  const T0 = 1_000_000;

  it('pierwsza wysyłka na adres przechodzi, druga w oknie 10 min jest pomijana', () => {
    const limiter = new RegistrationMailLimiter();

    expect(limiter.tryAcquire('a@firma.pl', T0)).toBe(true);
    expect(limiter.tryAcquire('a@firma.pl', T0 + 9 * 60_000)).toBe(false);
  });

  it('po upływie okna znów przechodzi', () => {
    const limiter = new RegistrationMailLimiter();
    limiter.tryAcquire('a@firma.pl', T0);

    expect(limiter.tryAcquire('a@firma.pl', T0 + 10 * 60_000)).toBe(true);
  });

  it('nie rozróżnia wielkości liter i nie blokuje innych adresów', () => {
    const limiter = new RegistrationMailLimiter();
    limiter.tryAcquire('A@Firma.pl', T0);

    expect(limiter.tryAcquire('a@firma.pl', T0 + 1)).toBe(false);
    expect(limiter.tryAcquire('b@firma.pl', T0 + 1)).toBe(true);
  });

  it('nie rośnie bez granic (atak masowy różnymi adresami)', () => {
    const limiter = new RegistrationMailLimiter();
    for (let i = 0; i < 6000; i += 1) {
      limiter.tryAcquire(`u${i}@firma.pl`, T0);
    }

    // Wewnętrzna mapa jest ograniczona: ostatni adres nadal jest zapamiętany,
    // a najstarszy został wyparty.
    expect(limiter.tryAcquire('u5999@firma.pl', T0 + 1)).toBe(false);
    expect(limiter.tryAcquire('u0@firma.pl', T0 + 1)).toBe(true);
  });
});
