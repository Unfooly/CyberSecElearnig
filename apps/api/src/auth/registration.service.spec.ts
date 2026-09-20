import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { RegistrationService, REGISTRATION_ACCEPTED_MESSAGE } from './registration.service';
import { RegistrationMailLimiter } from './registration-mail-limiter';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AddressClaimService } from '../users/address-claim.service';
import { RegisterDto } from './dto/register.dto';

// bcrypt(12) kosztuje ~250 ms na hash - w testach jednostkowych podmieniamy (natywny
// moduł nie pozwala na jest.spyOn, więc mock modułu).
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const DTO: RegisterDto = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'anna@firma.pl',
  organizationLegalName: 'Firma Testowa Sp. z o.o.',
  organizationName: 'Firma Testowa',
  taxId: '526-025-02-74',
  addressLine: 'ul. Testowa 1',
  postalCode: '00-001',
  city: 'Warszawa',
  acceptTerms: true,
  acceptPrivacyPolicy: true,
};

function p2002(target: unknown, modelName?: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target, ...(modelName ? { modelName } : {}) },
  });
}

const existingUser = (over: Record<string, unknown> = {}) => ({
  id: 'u9',
  organizationId: 'o9',
  email: 'anna@firma.pl',
  firstName: 'Anna',
  status: 'ACTIVE',
  role: 'ORG_ADMIN',
  emailVerifiedAt: new Date(),
  ...over,
});

describe('RegistrationService', () => {
  let runAuthLookup: jest.Mock;
  let runInOrgContext: jest.Mock;
  let sendRegistrationActivation: jest.Mock;
  let sendVerificationOrActivation: jest.Mock;
  let sendEmail: jest.Mock;
  let displace: jest.Mock;
  let service: RegistrationService;
  let txCalls: Record<string, jest.Mock>;

  // Rejestracja robi całą pracę w tle - po każdym register() czekamy na jej koniec.
  const registerAndFlush = async (dto: RegisterDto = DTO) => {
    const result = await service.register(dto);
    await service.flushBackgroundTasks();
    return result;
  };

  beforeEach(() => {
    runAuthLookup = jest.fn().mockResolvedValue(null);
    displace = jest.fn().mockResolvedValue(false);
    sendRegistrationActivation = jest.fn().mockResolvedValue(true);
    sendVerificationOrActivation = jest.fn().mockResolvedValue(undefined);
    sendEmail = jest.fn().mockResolvedValue(true);
    txCalls = {
      organizationCreate: jest.fn().mockResolvedValue({}),
      userCreate: jest.fn().mockResolvedValue({ id: 'u1', email: 'anna@firma.pl' }),
      billingCreate: jest.fn().mockResolvedValue({}),
      domainCreate: jest.fn().mockResolvedValue({}),
      acceptanceCreateMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    runInOrgContext = jest.fn((_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        organization: { create: txCalls.organizationCreate },
        user: { create: txCalls.userCreate },
        organizationBillingDetails: { create: txCalls.billingCreate },
        organizationDomain: { create: txCalls.domainCreate },
        legalAcceptance: { createMany: txCalls.acceptanceCreateMany },
      }),
    );
    service = new RegistrationService(
      { runAuthLookup, runInOrgContext } as unknown as TenantPrismaService,
      { sendRegistrationActivation, sendVerificationOrActivation } as unknown as AuthService,
      { send: sendEmail } as unknown as EmailService,
      { get: (key: string) => (key === 'FRONTEND_URL' ? 'https://app.unfooly.test' : undefined) } as unknown as ConfigService,
      new RegistrationMailLimiter(),
      { displaceUnprotectedForRegistration: displace } as unknown as AddressClaimService,
    );
  });

  // Tylko spye na Logger (mock modułu bcrypt zostaje).
  afterEach(() => jest.restoreAllMocks());

  it('nowa firma: tworzy organizację PENDING, admina, dane do faktury, domenę i dwie zgody z wersją', async () => {
    const result = await registerAndFlush();

    expect(result).toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
    expect(txCalls.organizationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Firma Testowa', status: 'PENDING_DOMAIN_VERIFICATION' }),
    });
    // Konto bez hasła klienta (pre-hijacking): INVITED, niepotwierdzone, losowy hash zastępczy.
    expect(txCalls.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'anna@firma.pl',
        role: 'ORG_ADMIN',
        status: 'INVITED',
        firstName: 'Anna',
        lastName: 'Kowalska',
        passwordHash: 'hashed-password',
      }),
    });
    expect(txCalls.userCreate.mock.calls[0][0].data).not.toHaveProperty('emailVerifiedAt');
    expect(txCalls.billingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ legalName: 'Firma Testowa Sp. z o.o.', taxId: '5260250274', country: 'PL', postalCode: '00-001' }),
    });
    expect(txCalls.domainCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ domain: 'firma.pl', verificationToken: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    });
    const acceptances = txCalls.acceptanceCreateMany.mock.calls[0][0].data as { documentType: string; version: string }[];
    expect(acceptances.map((a) => a.documentType).sort()).toEqual(['PRIVACY_POLICY', 'TERMS']);
    expect(acceptances.every((a) => a.version === 'draft-1')).toBe(true);
    // Link z maila = potwierdzenie skrzynki + ustawienie hasła (nie zwykły link weryfikacyjny).
    expect(sendRegistrationActivation).toHaveBeenCalledTimes(1);
    expect(sendRegistrationActivation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'anna@firma.pl', organizationId: expect.any(String) }),
    );
  });

  it('odpowiedź wraca ZANIM praca się zacznie (czas odpowiedzi nie zależy od stanu konta)', async () => {
    let release: (value: unknown) => void = () => undefined;
    runAuthLookup.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const result = await service.register(DTO);

    expect(result).toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
    expect(runInOrgContext).not.toHaveBeenCalled();
    release(null);
    await service.flushBackgroundTasks();
    expect(runInOrgContext).toHaveBeenCalled();
  });

  it('nazwa organizacji NIE pochodzi z domeny e-maila', async () => {
    await registerAndFlush();

    const created = txCalls.organizationCreate.mock.calls[0][0].data as { name: string };
    expect(created.name).toBe('Firma Testowa');
    expect(created.name).not.toContain('firma.pl');
  });

  it.each(['gmail.com', 'WP.pl', 'o2.pl', 'outlook.com', 'proton.me', 'yahoo.com'])(
    'domena publiczna (%s) => 400 z kodem PUBLIC_EMAIL_DOMAIN, nic nie tworzy',
    async (domain) => {
      const promise = service.register({ ...DTO, email: `anna@${domain.toLowerCase()}` });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({ response: { code: 'PUBLIC_EMAIL_DOMAIN' } });
      await service.flushBackgroundTasks();
      expect(runAuthLookup).not.toHaveBeenCalled();
      expect(runInOrgContext).not.toHaveBeenCalled();
    },
  );

  it('anty-enumeracja: odpowiedź dla istniejącego konta jest IDENTYCZNA jak dla nowego', async () => {
    const forNew = await registerAndFlush();
    runAuthLookup.mockResolvedValueOnce(existingUser());
    const forExisting = await registerAndFlush({ ...DTO, email: 'anna2@firma.pl' });

    expect(forExisting).toEqual(forNew);
  });

  it('istniejące, ZWERYFIKOWANE konto: nie tworzy nic, wysyła mail do właściciela', async () => {
    runAuthLookup.mockResolvedValueOnce(existingUser());

    await registerAndFlush();

    expect(runInOrgContext).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'anna@firma.pl', templateName: 'registration-existing-account' }),
    );
    expect(sendVerificationOrActivation).not.toHaveBeenCalled();
  });

  it('istniejące, NIEZWERYFIKOWANE konto: dostaje nowy link (bez informacji "konto istnieje")', async () => {
    runAuthLookup.mockResolvedValueOnce(existingUser({ emailVerifiedAt: null }));

    await registerAndFlush();

    expect(sendVerificationOrActivation).toHaveBeenCalledWith(expect.objectContaining({ id: 'u9', organizationId: 'o9' }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('istniejące konto ZAPROSZONE (INVITED): przekazuje status, żeby poszedł link AKTYWACYJNY, nie weryfikacyjny', async () => {
    runAuthLookup.mockResolvedValueOnce(existingUser({ emailVerifiedAt: null, status: 'INVITED' }));

    await registerAndFlush();

    expect(sendVerificationOrActivation).toHaveBeenCalledWith(expect.objectContaining({ status: 'INVITED' }));
    expect(sendRegistrationActivation).not.toHaveBeenCalled();
  });

  it('nieaktywowane zaproszenie w obcej organizacji BEZ zweryfikowanej domeny adresu: zwalnia adres i rejestracja idzie jak dla nowego', async () => {
    const stale = existingUser({ emailVerifiedAt: null, status: 'INVITED', role: 'EMPLOYEE' });
    runAuthLookup.mockResolvedValueOnce(stale);
    displace.mockResolvedValueOnce(true);

    await registerAndFlush();

    expect(displace).toHaveBeenCalledWith(stale);
    expect(txCalls.organizationCreate).toHaveBeenCalledTimes(1);
    expect(sendVerificationOrActivation).not.toHaveBeenCalled();
    expect(sendRegistrationActivation).toHaveBeenCalledTimes(1);
  });

  it('zaproszenie chronione (organizacja ze zweryfikowaną domeną adresu): adres NIE jest przejmowany, właściciel dostaje link aktywacyjny', async () => {
    runAuthLookup.mockResolvedValueOnce(existingUser({ emailVerifiedAt: null, status: 'INVITED', role: 'EMPLOYEE' }));
    displace.mockResolvedValueOnce(false);

    await registerAndFlush();

    expect(txCalls.organizationCreate).not.toHaveBeenCalled();
    expect(sendVerificationOrActivation).toHaveBeenCalledTimes(1);
  });

  it('wyścig: P2002 na e-mailu => traktowane jak istniejące konto, odpowiedź uniform, bez wycieku meta', async () => {
    runInOrgContext.mockRejectedValueOnce(p2002(['email']));
    runAuthLookup.mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser());

    const result = await registerAndFlush();

    expect(result).toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
    expect(JSON.stringify(result)).not.toMatch(/email|unique|constraint/i);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'registration-existing-account' }));
  });

  it('wyścig: P2002 z meta.target = null (tak bywa w transakcji interaktywnej), ale z modelName User => też konto istnieje', async () => {
    runInOrgContext.mockRejectedValueOnce(p2002(null, 'User'));
    runAuthLookup.mockResolvedValueOnce(null).mockResolvedValueOnce(existingUser());

    await expect(registerAndFlush()).resolves.toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'registration-existing-account' }));
  });

  it('nieoczekiwana kolizja unikalności (inny model) => odpowiedź bez zmian, błąd tylko w logu (bez meta)', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    runInOrgContext.mockRejectedValueOnce(p2002(['organizationId', 'domain'], 'OrganizationDomain'));

    await expect(registerAndFlush()).resolves.toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });

    expect(errorLog).toHaveBeenCalled();
    expect(errorLog.mock.calls.flat().join(' ')).not.toMatch(/organizationId|domain'/);
    expect(sendRegistrationActivation).not.toHaveBeenCalled();
  });

  it('awaria wysyłki maila NIE zmienia odpowiedzi rejestracji', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    sendRegistrationActivation.mockRejectedValue(new Error('smtp down'));

    await expect(registerAndFlush()).resolves.toEqual({ message: REGISTRATION_ACCEPTED_MESSAGE });
  });

  it('limiter: druga rejestracja tego samego adresu w oknie nie wysyła kolejnego maila (ale odpowiedź ta sama)', async () => {
    runAuthLookup.mockResolvedValue(existingUser());

    const first = await registerAndFlush();
    const second = await registerAndFlush();

    expect(second).toEqual(first);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('limiter: alias "+tag" tej samej skrzynki dzieli limit (nie da się zalać skrzynki przez ofiara+1, ofiara+2...)', async () => {
    runAuthLookup.mockResolvedValue(existingUser());

    await registerAndFlush({ ...DTO, email: 'ofiara@firma.pl' });
    await registerAndFlush({ ...DTO, email: 'ofiara+1@firma.pl' });
    await registerAndFlush({ ...DTO, email: 'ofiara+2@firma.pl' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('przeciążenie: ponad 50 rejestracji w toku => 503 (ochrona CPU), bez zmiany stanu jakiegokolwiek konta', async () => {
    runAuthLookup.mockReturnValue(new Promise(() => undefined));
    for (let i = 0; i < 50; i += 1) {
      await service.register({ ...DTO, email: `u${i}@firma.pl` });
    }

    await expect(service.register({ ...DTO, email: 'u51@firma.pl' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
