import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const validRegistration = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'Anna@Firma.pl',
  organizationLegalName: 'Firma Testowa Sp. z o.o.',
  organizationName: 'Firma Testowa',
  taxId: '526-025-02-74',
  addressLine: 'ul. Testowa 1/2',
  postalCode: '00-001',
  city: 'Warszawa',
  acceptTerms: true,
  acceptPrivacyPolicy: true,
};

async function errorsFor(overrides: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, { ...validRegistration, ...overrides });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((error) => error.property) };
}

describe('RegisterDto', () => {
  it('poprawne dane przechodzą, e-mail jest normalizowany, pola tekstowe przycinane', async () => {
    const { dto, fields } = await errorsFor({ organizationName: '  Firma Testowa  ' });

    expect(fields).toEqual([]);
    expect(dto.email).toBe('anna@firma.pl');
    expect(dto.organizationName).toBe('Firma Testowa');
  });

  it.each([
    ['NIP z błędną sumą kontrolną', { taxId: '5260250275' }, 'taxId'],
    ['NIP o złej długości', { taxId: '12345' }, 'taxId'],
    ['kod pocztowy w złym formacie', { postalCode: '00001' }, 'postalCode'],
    ['kraj inny niż PL', { country: 'DE' }, 'country'],
    ['brak zgody na regulamin', { acceptTerms: false }, 'acceptTerms'],
    ['brak zgody na politykę prywatności', { acceptPrivacyPolicy: false }, 'acceptPrivacyPolicy'],
    ['zgoda jako string zamiast boolean', { acceptTerms: 'true' }, 'acceptTerms'],
    ['imię z frazą phishingową (cyfry, dwukropek)', { firstName: 'Konto: kliknij http://x.pl' }, 'firstName'],
    ['puste imię', { firstName: '   ' }, 'firstName'],
    ['nazwa firmy z nową linią', { organizationName: 'Firma\nBcc: x@y.pl' }, 'organizationName'],
    // Brak pola hasła w rejestracji (pre-hijacking): hasło ustawia się po weryfikacji skrzynki.
    ['hasło w rejestracji (nie jest przyjmowane)', { password: 'SuperSecret123!' }, 'password'],
    ['zły e-mail', { email: 'nie-email' }, 'email'],
  ])('odrzuca: %s', async (_label, overrides, field) => {
    const { fields } = await errorsFor(overrides);

    expect(fields).toContain(field);
  });

  // Znaki budowane z kodów (nie literałami) - literalne U+2028/2029 w źródle
  // łamią parsowanie pliku.
  const rlo = String.fromCharCode(0x202e); // bidi override
  const zeroWidth = String.fromCharCode(0x200b);
  const lineSeparator = String.fromCharCode(0x2028);
  const c1Control = String.fromCharCode(0x0085);

  it.each([
    ['znak bidi override', `Firma ${rlo}gnp.exe`],
    ['zero-width space', `Fir${zeroWidth}ma`],
    ['separator linii U+2028', `Firma${lineSeparator}Bcc: x@y.pl`],
    ['znak sterujący C1', `Firma${c1Control}X`],
    ['nowa linia', 'Firma\r\nBcc: x@y.pl'],
  ])('nazwa firmy odrzuca: %s', async (_label, organizationName) => {
    const { fields } = await errorsFor({ organizationName });

    expect(fields).toContain('organizationName');
  });

  it('nazwa firmy z polskimi znakami, kropkami i cyframi jest OK', async () => {
    expect((await errorsFor({ organizationName: 'Zażółć Gęślą Jaźń 2 Sp. z o.o.' })).fields).toEqual([]);
  });

  it('e-mail z domeną IDN jest normalizowany do punycode (jedna skrzynka = jedno konto)', async () => {
    const { dto } = await errorsFor({ email: `Jan@b${String.fromCharCode(0xfc)}cher.de` });

    expect(dto.email).toBe('jan@xn--bcher-kva.de');
  });

  it('kraj PL jest dozwolony (i opcjonalny)', async () => {
    expect((await errorsFor({ country: 'PL' })).fields).toEqual([]);
  });

  it('nieznane pole (np. status organizacji albo rola) jest odrzucane', async () => {
    const { fields } = await errorsFor({ role: 'SUPER_ADMIN', status: 'ACTIVE' });

    expect(fields).toEqual(expect.arrayContaining(['role', 'status']));
  });
});
