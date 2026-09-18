import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EmailService } from '../email/email.service';

describe('AuthService — reset hasła', () => {
  let service: AuthService;
  let runAuthLookup: jest.Mock;
  let runInOrgContext: jest.Mock;
  let runPasswordResetTokenLookup: jest.Mock;
  let sendEmail: jest.Mock;
  let passwordResetTokenDeleteMany: jest.Mock;
  let passwordResetTokenCreate: jest.Mock;
  let passwordResetTokenUpdateMany: jest.Mock;
  let userUpdate: jest.Mock;
  let runEmailVerificationTokenLookup: jest.Mock;
  let verificationTokenCreate: jest.Mock;
  let verificationTokenDeleteMany: jest.Mock;
  let verificationTokenUpdateMany: jest.Mock;
  let jwtSign: jest.Mock;

  beforeEach(async () => {
    passwordResetTokenDeleteMany = jest.fn();
    passwordResetTokenCreate = jest.fn();
    // Domyślnie "udany claim" (1 zaktualizowany wiersz) - testy wyścigu/
    // ponownego użycia nadpisują to na {count: 0} dla konkretnego wywołania.
    passwordResetTokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    userUpdate = jest.fn();
    sendEmail = jest.fn().mockResolvedValue(undefined);

    runAuthLookup = jest.fn();
    runEmailVerificationTokenLookup = jest.fn();
    verificationTokenCreate = jest.fn();
    verificationTokenDeleteMany = jest.fn();
    verificationTokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    jwtSign = jest.fn().mockResolvedValue('jwt');
    runPasswordResetTokenLookup = jest.fn();
    runInOrgContext = jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetToken: {
          deleteMany: passwordResetTokenDeleteMany,
          create: passwordResetTokenCreate,
          updateMany: passwordResetTokenUpdateMany,
        },
        user: { update: userUpdate },
        organization: { findUnique: jest.fn().mockResolvedValue({ name: 'firma.pl' }) },
        emailVerificationToken: {
          create: verificationTokenCreate,
          deleteMany: verificationTokenDeleteMany,
          updateMany: verificationTokenUpdateMany,
        },
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: TenantPrismaService,
          useValue: { runAuthLookup, runInOrgContext, runPasswordResetTokenLookup, runEmailVerificationTokenLookup },
        },
        { provide: JwtService, useValue: { signAsync: jwtSign, verifyAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EmailService, useValue: { send: sendEmail } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register — kolizja unikalności (P2002)', () => {
    function p2002(target: unknown) {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
        meta: { target },
      });
    }

    it.each([
      ['tablica kolumn', ['name']],
      ['nazwa constraintu', 'organizations_name_key'],
    ])('kolizja nazwy organizacji (%s) daje komunikat o istniejącej organizacji', async (_label, target) => {
      runInOrgContext.mockRejectedValueOnce(p2002(target));

      await expect(service.register({ email: 'a@firma.pl', password: 'SuperSecret123!' })).rejects.toThrow(
        /Organizacja dla domeny/,
      );
    });

    it('kolizja e-maila daje ogólny komunikat, nie ujawnia istnienia organizacji', async () => {
      runInOrgContext.mockRejectedValueOnce(p2002(['email']));

      await expect(service.register({ email: 'a@firma.pl', password: 'SuperSecret123!' })).rejects.toThrow(
        /Nie udało się utworzyć konta/,
      );
    });
  });

  describe('weryfikacja adresu e-mail', () => {
    const validRecord = {
      id: 't1',
      organizationId: 'o1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };

    async function unverifiedUser() {
      return {
        id: 'u1',
        organizationId: 'o1',
        role: 'ORG_ADMIN',
        email: 'a@firma.pl',
        passwordHash: await bcrypt.hash('SuperSecret123!', 4),
        emailVerifiedAt: null,
      };
    }

    it('register NIE zwraca tokenów, wystawia token weryfikacyjny i wysyła e-mail', async () => {
      runInOrgContext.mockImplementationOnce((_id: string, fn: (tx: unknown) => unknown) =>
        fn({
          organization: { create: jest.fn() },
          user: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'u1', organizationId: 'o1', role: 'ORG_ADMIN', email: 'a@firma.pl' }),
          },
        }),
      );

      const result = await service.register({ email: 'a@firma.pl', password: 'SuperSecret123!' });

      expect(result).toEqual({ message: expect.stringMatching(/link weryfikacyjny/), emailSent: true });
      expect(jwtSign).not.toHaveBeenCalled();
      expect(verificationTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: 'o1', userId: 'u1' }) }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@firma.pl', templateName: 'email-verification' }),
      );
    });

    const createdUserTx = () =>
      (_id: string, fn: (tx: unknown) => unknown) =>
        fn({
          organization: { create: jest.fn() },
          user: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'u1', organizationId: 'o1', role: 'ORG_ADMIN', email: 'a@firma.pl' }),
          },
        });

    it('register: gdy mail nie wyszedł (send=false), zwraca emailSent=false i komunikat z podpowiedzią - konto zostaje', async () => {
      runInOrgContext.mockImplementationOnce(createdUserTx());
      sendEmail.mockResolvedValue(false);

      const result = await service.register({ email: 'a@firma.pl', password: 'SuperSecret123!' });

      expect(result.emailSent).toBe(false);
      expect(result.message).toMatch(/nie udało się wysłać/i);
    });

    it('register: wyjątek przy wystawianiu tokenu po utworzeniu konta NIE zamienia rejestracji w 500', async () => {
      runInOrgContext.mockImplementationOnce(createdUserTx());
      verificationTokenCreate.mockRejectedValue(new Error('db down'));

      const result = await service.register({ email: 'a@firma.pl', password: 'SuperSecret123!' });

      expect(result.emailSent).toBe(false);
    });

    it('resendVerification dla ZAPROSZONEGO (INVITED) odnawia link aktywacyjny, nie weryfikacyjny', async () => {
      runAuthLookup.mockResolvedValueOnce({
        id: 'u3',
        organizationId: 'o1',
        email: 'inv@f.pl',
        firstName: 'Ola',
        status: 'INVITED',
        emailVerifiedAt: null,
      });

      await service.resendVerification({ email: 'inv@f.pl' });

      expect(passwordResetTokenCreate).toHaveBeenCalled();
      expect(verificationTokenCreate).not.toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'inv@f.pl',
          templateName: 'user-invite',
          templateData: expect.objectContaining({ organizationName: 'firma.pl' }),
        }),
      );
    });

    it('refresh odrzuca token użytkownika bez potwierdzonego adresu e-mail', async () => {
      const verifyAsync = jest.fn().mockResolvedValue({ sub: 'u1' });
      (service as unknown as { jwtService: { verifyAsync: jest.Mock } }).jwtService.verifyAsync = verifyAsync;
      runAuthLookup.mockResolvedValue({ id: 'u1', organizationId: 'o1', role: 'ORG_ADMIN', email: 'a@f.pl', emailVerifiedAt: null });

      await expect(service.refresh('rt')).rejects.toThrow(/refresh token/i);
      expect(jwtSign).not.toHaveBeenCalled();
    });

    it('login odrzuca (403 EMAIL_NOT_VERIFIED) poprawne hasło niepotwierdzonego konta', async () => {
      runAuthLookup.mockResolvedValue(await unverifiedUser());

      await expect(service.login({ email: 'a@firma.pl', password: 'SuperSecret123!' })).rejects.toMatchObject({
        response: { code: 'EMAIL_NOT_VERIFIED' },
      });
      expect(jwtSign).not.toHaveBeenCalled();
    });

    it('login niepotwierdzonego konta ze ZŁYM hasłem daje zwykłe 401 (bez ujawniania statusu)', async () => {
      runAuthLookup.mockResolvedValue(await unverifiedUser());

      await expect(service.login({ email: 'a@firma.pl', password: 'zle-haslo-123' })).rejects.toThrow(
        /Nieprawidłowy e-mail lub hasło/,
      );
    });

    it('verifyEmail: poprawny token ustawia emailVerifiedAt', async () => {
      runEmailVerificationTokenLookup.mockResolvedValue(validRecord);

      await service.verifyEmail({ token: 'raw' });

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });

    it('verifyEmail odrzuca nieistniejący, wygasły i już użyty token', async () => {
      runEmailVerificationTokenLookup.mockResolvedValueOnce(null);
      await expect(service.verifyEmail({ token: 'x' })).rejects.toMatchObject({
        response: { code: 'TOKEN_INVALID_OR_EXPIRED' },
      });

      runEmailVerificationTokenLookup.mockResolvedValueOnce({ ...validRecord, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.verifyEmail({ token: 'x' })).rejects.toMatchObject({
        response: { code: 'TOKEN_INVALID_OR_EXPIRED' },
      });

      runEmailVerificationTokenLookup.mockResolvedValueOnce({ ...validRecord, usedAt: new Date() });
      await expect(service.verifyEmail({ token: 'x' })).rejects.toMatchObject({
        response: { code: 'TOKEN_ALREADY_USED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('verifyEmail: przegrany wyścig (claim.count=0) daje "już użyty" i nie aktywuje konta', async () => {
      runEmailVerificationTokenLookup.mockResolvedValue(validRecord);
      verificationTokenUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.verifyEmail({ token: 'raw' })).rejects.toMatchObject({
        response: { code: 'TOKEN_ALREADY_USED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('resendVerification: identyczna odpowiedź dla każdego przypadku, wysyła tylko dla niepotwierdzonego', async () => {
      runAuthLookup.mockResolvedValueOnce({
        id: 'u1',
        organizationId: 'o1',
        email: 'a@f.pl',
        status: 'ACTIVE',
        emailVerifiedAt: null,
      });
      const existing = await service.resendVerification({ email: 'a@f.pl' });
      expect(sendEmail).toHaveBeenCalledTimes(1);

      runAuthLookup.mockResolvedValueOnce(null);
      const missing = await service.resendVerification({ email: 'brak@f.pl' });

      runAuthLookup.mockResolvedValueOnce({
        id: 'u2',
        organizationId: 'o1',
        email: 'b@f.pl',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      });
      const verified = await service.resendVerification({ email: 'b@f.pl' });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(existing).toEqual(missing);
      expect(existing).toEqual(verified);
    });

    it('resetPassword potwierdza też adres e-mail (klik w link z maila)', async () => {
      runPasswordResetTokenLookup.mockResolvedValue({
        id: 'token-1',
        organizationId: 'org-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      await service.resetPassword({ token: 'raw', newPassword: 'NoweHaslo123' });

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ emailVerifiedAt: expect.any(Date), status: 'ACTIVE' }),
      });
    });
  });

  describe('forgotPassword', () => {
    it('dla istniejącego e-maila tworzy token, usuwa poprzednie nieużyte i wysyła e-mail', async () => {
      runAuthLookup.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        email: 'user@test.pl',
      });

      const result = await service.forgotPassword({ email: 'user@test.pl' });

      expect(passwordResetTokenDeleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
      });
      expect(passwordResetTokenCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
        }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@test.pl', templateName: 'password-reset' }),
      );
      expect(result.message).toMatch(/Jeśli podany adres e-mail istnieje/);
    });

    it('dla nieistniejącego e-maila NIE tworzy tokenu ani nie wysyła e-maila, ale zwraca tę samą odpowiedź', async () => {
      runAuthLookup.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'brak@test.pl' });

      expect(passwordResetTokenCreate).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(result.message).toMatch(/Jeśli podany adres e-mail istnieje/);
    });
  });

  describe('resetPassword', () => {
    const validRecord = {
      id: 'token-1',
      organizationId: 'org-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    };

    it('happy path — ustawia nowe hasło (bcrypt) i oznacza token jako zużyty (atomowy claim, potem update)', async () => {
      runPasswordResetTokenLookup.mockResolvedValue(validRecord);

      await service.resetPassword({ token: 'raw-token', newPassword: 'NoweHaslo123' });

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: expect.any(String), status: 'ACTIVE', emailVerifiedAt: expect.any(Date) },
      });
      const newHash = userUpdate.mock.calls[0][0].data.passwordHash;
      await expect(bcrypt.compare('NoweHaslo123', newHash)).resolves.toBe(true);

      // Pierwsze wywołanie: atomowy claim TEGO konkretnego tokenu
      // (WHERE id + usedAt IS NULL + nie wygasł).
      expect(passwordResetTokenUpdateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'token-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { usedAt: expect.any(Date) },
      });
      // Drugie: oznaczenie pozostałych nieużytych tokenów tego usera.
      expect(passwordResetTokenUpdateMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('wyścig: gdy atomowy claim trafia 0 wierszy (token zużyty równolegle), odrzuca jako "już użyty" i NIE zmienia hasła', async () => {
      runPasswordResetTokenLookup.mockResolvedValue(validRecord);
      // Symulacja: między SELECT (runPasswordResetTokenLookup) a tym UPDATE
      // inne równoległe żądanie zdążyło zużyć token - claim trafia 0 wierszy.
      passwordResetTokenUpdateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.resetPassword({ token: 'raw-token', newPassword: 'NoweHaslo123' }),
      ).rejects.toMatchObject({ response: { code: 'TOKEN_ALREADY_USED' } });

      expect(userUpdate).not.toHaveBeenCalled();
      // Tylko JEDNO wywołanie updateMany - nieudany claim, więc druga
      // aktualizacja (oznaczenie pozostałych tokenów) nigdy nie następuje.
      expect(passwordResetTokenUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('odrzuca nieistniejący token z generycznym komunikatem (nie ujawnia że nie istnieje)', async () => {
      runPasswordResetTokenLookup.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'brak-takiego', newPassword: 'NoweHaslo123' }),
      ).rejects.toMatchObject({
        response: { code: 'TOKEN_INVALID_OR_EXPIRED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('odrzuca wygasły token z tym samym kodem co "nieistniejący"', async () => {
      runPasswordResetTokenLookup.mockResolvedValue({
        ...validRecord,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword({ token: 'wygasly', newPassword: 'NoweHaslo123' }),
      ).rejects.toMatchObject({
        response: { code: 'TOKEN_INVALID_OR_EXPIRED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('odrzuca już użyty token z ODRĘBNYM kodem/komunikatem (sygnał możliwego przejęcia konta)', async () => {
      runPasswordResetTokenLookup.mockResolvedValue({
        ...validRecord,
        usedAt: new Date(),
      });

      await expect(
        service.resetPassword({ token: 'juz-uzyty', newPassword: 'NoweHaslo123' }),
      ).rejects.toMatchObject({
        response: { code: 'TOKEN_ALREADY_USED' },
      });
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('rzuca BadRequestException (400), nie inny typ wyjątku', async () => {
      runPasswordResetTokenLookup.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'brak', newPassword: 'NoweHaslo123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
