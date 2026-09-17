import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
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

  beforeEach(async () => {
    passwordResetTokenDeleteMany = jest.fn();
    passwordResetTokenCreate = jest.fn();
    // Domyślnie "udany claim" (1 zaktualizowany wiersz) - testy wyścigu/
    // ponownego użycia nadpisują to na {count: 0} dla konkretnego wywołania.
    passwordResetTokenUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    userUpdate = jest.fn();
    sendEmail = jest.fn().mockResolvedValue(undefined);

    runAuthLookup = jest.fn();
    runPasswordResetTokenLookup = jest.fn();
    runInOrgContext = jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
      fn({
        passwordResetToken: {
          deleteMany: passwordResetTokenDeleteMany,
          create: passwordResetTokenCreate,
          updateMany: passwordResetTokenUpdateMany,
        },
        user: { update: userUpdate },
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: TenantPrismaService,
          useValue: { runAuthLookup, runInOrgContext, runPasswordResetTokenLookup },
        },
        { provide: JwtService, useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EmailService, useValue: { send: sendEmail } },
      ],
    }).compile();

    service = module.get(AuthService);
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
        data: { passwordHash: expect.any(String) },
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
