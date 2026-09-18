import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.19.1',
    meta: { target },
  });
}

describe('UsersService', () => {
  let service: UsersService;
  let runInOrgContext: jest.Mock;
  let departmentFindFirst: jest.Mock;
  let departmentUpsert: jest.Mock;
  let userCreate: jest.Mock;
  let userFindFirst: jest.Mock;
  let userDelete: jest.Mock;
  let userUpdate: jest.Mock;
  let userCount: jest.Mock;
  let tokenCount: jest.Mock;
  let tokenFindFirst: jest.Mock;
  let issuePasswordResetUrl: jest.Mock;
  let sendEmail: jest.Mock;

  beforeEach(async () => {
    departmentFindFirst = jest.fn();
    departmentUpsert = jest.fn();
    userCreate = jest.fn();
    userFindFirst = jest.fn();
    userDelete = jest.fn();
    userUpdate = jest.fn();
    userCount = jest.fn();
    tokenCount = jest.fn().mockResolvedValue(0);
    tokenFindFirst = jest.fn().mockResolvedValue(null);
    issuePasswordResetUrl = jest.fn().mockResolvedValue('http://localhost:3000/reset-password?token=abc');
    sendEmail = jest.fn().mockResolvedValue(undefined);

    runInOrgContext = jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
      fn({
        organization: { findUnique: jest.fn().mockResolvedValue({ name: 'firma.pl' }) },
        passwordResetToken: { count: tokenCount, findFirst: tokenFindFirst },
        department: { findFirst: departmentFindFirst, upsert: departmentUpsert },
        user: {
          create: userCreate,
          findFirst: userFindFirst,
          delete: userDelete,
          update: userUpdate,
          count: userCount,
        },
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: TenantPrismaService, useValue: { runInOrgContext } },
        { provide: AuthService, useValue: { issuePasswordResetUrl } },
        { provide: EmailService, useValue: { send: sendEmail } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('inviteUser', () => {
    it('odrzuca departmentId, który nie należy do organizacji wywołującego (izolacja tenantów)', async () => {
      departmentFindFirst.mockResolvedValue(null);

      await expect(
        service.inviteUser('org-a', {
          email: 'nowy@test.pl',
          firstName: 'Jan',
          lastName: 'Kowalski',
          departmentId: 'dept-from-org-b',
          role: 'EMPLOYEE' as never,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(departmentFindFirst).toHaveBeenCalledWith({
        where: { id: 'dept-from-org-b', organizationId: 'org-a' },
      });
      expect(userCreate).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('happy path: tworzy usera ze status INVITED i wysyła e-mail z zaproszeniem', async () => {
      userCreate.mockResolvedValue({
        id: 'user-1',
        email: 'nowy@test.pl',
        firstName: 'Jan',
        lastName: 'Kowalski',
        role: 'EMPLOYEE',
        status: 'INVITED',
        createdAt: new Date(),
        department: null,
      });

      const result = await service.inviteUser('org-a', {
        email: 'nowy@test.pl',
        firstName: 'Jan',
        lastName: 'Kowalski',
        role: 'EMPLOYEE' as never,
      });

      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'INVITED', organizationId: 'org-a' }),
        }),
      );
      expect(issuePasswordResetUrl).toHaveBeenCalledWith('org-a', 'user-1');
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'nowy@test.pl', templateName: 'user-invite' }),
      );
      expect(result.status).toBe('INVITED');
    });
  });

  describe('powiadomienie o dodaniu do organizacji', () => {
    it('e-mail zaproszenia zawiera nazwę organizacji i osobę zapraszającą', async () => {
      userCreate.mockResolvedValue({
        id: 'user-1',
        email: 'nowy@test.pl',
        firstName: 'Jan',
        lastName: 'K',
        role: 'EMPLOYEE',
        status: 'INVITED',
        createdAt: new Date(),
        department: null,
      });

      await service.inviteUser(
        'org-a',
        { email: 'nowy@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE' as never },
        'admin@firma.pl',
      );

      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('firma.pl'),
          templateData: expect.objectContaining({ organizationName: 'firma.pl', invitedBy: 'admin@firma.pl' }),
        }),
      );
    });
  });

  describe('informacja o nieudanej wysyłce zaproszenia', () => {
    const created = {
      id: 'user-1',
      email: 'nowy@test.pl',
      firstName: 'Jan',
      lastName: 'K',
      role: 'EMPLOYEE',
      status: 'INVITED',
      createdAt: new Date(),
      department: null,
    };
    const dto = { email: 'nowy@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE' as never };

    it('inviteUser zwraca inviteEmailSent=false, gdy dostawca odrzucił e-mail (konto zostaje)', async () => {
      userCreate.mockResolvedValue(created);
      sendEmail.mockResolvedValue(false);

      const result = await service.inviteUser('org-a', dto);

      expect(result.id).toBe('user-1');
      expect(result.inviteEmailSent).toBe(false);
    });

    it('inviteUser zwraca inviteEmailSent=true, gdy wysyłka się udała', async () => {
      userCreate.mockResolvedValue(created);
      sendEmail.mockResolvedValue(true);

      expect((await service.inviteUser('org-a', dto)).inviteEmailSent).toBe(true);
    });

    it('importCsv liczy konta z nieudaną wysyłką w emailFailedCount', async () => {
      userCreate.mockResolvedValue(created);
      sendEmail.mockResolvedValue(false);

      const report = await service.importCsv('org-a', 'email,firstName,lastName\nnowy@test.pl,Jan,K\n');

      expect(report.successCount).toBe(1);
      expect(report.emailFailedCount).toBe(1);
    });

    it('resendInvite wysyła ponownie dla konta INVITED', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-1', email: 'nowy@test.pl', firstName: 'Jan', status: 'INVITED' });
      sendEmail.mockResolvedValue(true);

      const result = await service.resendInvite('org-a', 'user-1', 'admin@firma.pl');

      expect(result).toEqual({ inviteEmailSent: true });
      expect(issuePasswordResetUrl).toHaveBeenCalledWith('org-a', 'user-1');
    });

    it('resendInvite odrzuca konto już aktywne i nieistniejące (też z innej organizacji)', async () => {
      userFindFirst.mockResolvedValueOnce({ id: 'user-1', status: 'ACTIVE' });
      await expect(service.resendInvite('org-a', 'user-1')).rejects.toThrow(/już aktywne/);

      userFindFirst.mockResolvedValueOnce(null);
      await expect(service.resendInvite('org-a', 'user-x')).rejects.toThrow(/nie istnieje/);
      expect(userFindFirst).toHaveBeenLastCalledWith({ where: { id: 'user-x', organizationId: 'org-a' } });
    });
  });

  describe('ochrona przed nadużyciem zaproszeń', () => {
    const dto = { email: 'nowy@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE' as never };

    it('inviteUser odrzuca (429), gdy organizacja wyczerpała dobowy limit zaproszeń', async () => {
      tokenCount.mockResolvedValue(300);

      await expect(service.inviteUser('org-a', dto)).rejects.toMatchObject({ status: 429 });
      expect(userCreate).not.toHaveBeenCalled();
    });

    it('importCsv odrzuca cały plik z góry, gdy liczba wierszy przekroczyłaby dobowy limit', async () => {
      tokenCount.mockResolvedValue(299);

      await expect(
        service.importCsv('org-a', 'email,firstName,lastName\na@test.pl,Jan,K\nb@test.pl,Ewa,K\n'),
      ).rejects.toMatchObject({ status: 429 });
      expect(userCreate).not.toHaveBeenCalled();
    });

    it('resendInvite odrzuca (429) ponowną wysyłkę do tej samej osoby w ciągu cooldownu', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@test.pl', firstName: 'A', status: 'INVITED' });
      tokenFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 30_000) });

      await expect(service.resendInvite('org-a', 'user-1')).rejects.toMatchObject({ status: 429 });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('resendInvite wysyła, gdy poprzednie zaproszenie było dawno', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-1', email: 'a@test.pl', firstName: 'A', status: 'INVITED' });
      tokenFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 10 * 60_000) });

      await expect(service.resendInvite('org-a', 'user-1')).resolves.toEqual({ inviteEmailSent: true });
    });

    it('importCsv odrzuca wiersz z frazą phishingową zamiast imienia (allowlista znaków)', async () => {
      userCreate.mockResolvedValue({
        id: 'u1',
        email: 'ok@test.pl',
        firstName: 'Jan',
        lastName: 'K',
        role: 'EMPLOYEE',
        status: 'INVITED',
        createdAt: new Date(),
        department: null,
      });

      const report = await service.importCsv(
        'org-a',
        'email,firstName,lastName\nok@test.pl,Jan,K\nzly@test.pl,"Konto zablokowane: kliknij http://x.pl",K\n',
      );

      expect(report.successCount).toBe(1);
      expect(report.errors).toEqual([
        { line: 3, email: 'zly@test.pl', reason: 'Niedozwolone znaki w imieniu lub nazwisku' },
      ]);
    });
  });

  describe('importCsv', () => {
    it('przetwarza plik z poprawnym, niepoprawnym i zduplikowanym wierszem - liczy sukcesy/błędy per wiersz', async () => {
      // Wiersz 2: poprawny -> sukces.
      // Wiersz 3: zły format e-maila -> błąd walidacji, zero zapisów do bazy.
      // Wiersz 4: e-mail, który baza odrzuca jako duplikat (P2002) -> błąd,
      // ale NIE przerywa przetwarzania kolejnych/wcześniejszych wierszy.
      const csv =
        'email,firstName,lastName,departmentName\n' +
        'jan@test.pl,Jan,Kowalski,IT\n' +
        'zly-format,Anna,Nowak,\n' +
        'zajety@test.pl,Piotr,Zajac,\n';

      userCreate
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'jan@test.pl',
          firstName: 'Jan',
          lastName: 'Kowalski',
          role: 'EMPLOYEE',
          status: 'INVITED',
          createdAt: new Date(),
          department: { id: 'dept-1', name: 'IT' },
        })
        .mockRejectedValueOnce(p2002(['email']));

      departmentUpsert.mockResolvedValue({ id: 'dept-1', organizationId: 'org-a', name: 'IT' });

      const report = await service.importCsv('org-a', csv);

      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(2);
      expect(report.errors).toEqual([
        { line: 3, email: 'zly-format', reason: 'Nieprawidłowy format e-maila' },
        { line: 4, email: 'zajety@test.pl', reason: 'Nie można użyć tego adresu e-mail.' },
      ]);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('normalizuje e-mail do małych liter i odrzuca zbyt długie pola', async () => {
      userCreate.mockResolvedValue({
        id: 'user-1',
        email: 'jan@test.pl',
        firstName: 'Jan',
        lastName: 'K',
        role: 'EMPLOYEE',
        status: 'INVITED',
        createdAt: new Date(),
        department: null,
      });

      const report = await service.importCsv(
        'org-a',
        `email,firstName,lastName
JAN@Test.PL,Jan,K
x@test.pl,${'a'.repeat(101)},K
`,
      );

      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'jan@test.pl' }) }),
      );
      expect(report.errors).toEqual([{ line: 3, email: 'x@test.pl', reason: 'Zbyt długa wartość w polu' }]);
    });

    it('nie przerywa zaproszenia, gdy wystawienie tokenu/e-maila się nie uda (konto już istnieje)', async () => {
      userCreate.mockResolvedValue({
        id: 'user-1',
        email: 'nowy@test.pl',
        firstName: 'Jan',
        lastName: 'K',
        role: 'EMPLOYEE',
        status: 'INVITED',
        createdAt: new Date(),
        department: null,
      });
      issuePasswordResetUrl.mockRejectedValue(new Error('db down'));

      const result = await service.inviteUser('org-a', {
        email: 'nowy@test.pl',
        firstName: 'Jan',
        lastName: 'K',
        role: 'EMPLOYEE' as never,
      });

      expect(result.id).toBe('user-1');
    });

    it('odrzuca cały plik, gdy w nagłówku brakuje wymaganych kolumn', async () => {
      await expect(service.importCsv('org-a', 'email,firstName\njan@test.pl,Jan\n')).rejects.toThrow(
        BadRequestException,
      );
      expect(userCreate).not.toHaveBeenCalled();
    });

    it('odrzuca strukturalnie uszkodzony plik CSV (niesparowany cudzysłów)', async () => {
      await expect(
        service.importCsv('org-a', 'email,firstName,lastName\n"jan@test.pl,Jan,Kowalski\n'),
      ).rejects.toThrow(BadRequestException);
      expect(userCreate).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('odrzuca zmianę własnej roli (ORG_ADMIN nie może się sam zdegradować)', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-1', role: 'ORG_ADMIN' });

      await expect(service.updateUser('org-a', 'user-1', 'user-1', { role: 'EMPLOYEE' as never })).rejects.toThrow(
        /własnej roli/,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('odrzuca degradację ostatniego ORG_ADMIN-a organizacji', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-2', role: 'ORG_ADMIN' });
      userCount.mockResolvedValue(0);

      await expect(service.updateUser('org-a', 'user-1', 'user-2', { role: 'EMPLOYEE' as never })).rejects.toThrow(
        /co najmniej jednego administratora/,
      );
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('pozwala zdegradować ORG_ADMIN-a, gdy zostaje inny administrator', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-2', role: 'ORG_ADMIN' });
      userCount.mockResolvedValue(1);
      userUpdate.mockResolvedValue({
        id: 'user-2',
        email: 'b@test.pl',
        firstName: null,
        lastName: null,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        createdAt: new Date(),
        department: null,
      });

      await service.updateUser('org-a', 'user-1', 'user-2', { role: 'EMPLOYEE' as never });

      expect(userUpdate).toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('odrzuca usunięcie ostatniego ORG_ADMIN-a', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-2', role: 'ORG_ADMIN' });
      userCount.mockResolvedValue(0);

      await expect(service.deleteUser('org-a', 'user-1', 'user-2')).rejects.toThrow(BadRequestException);
      expect(userDelete).not.toHaveBeenCalled();
    });

    it('odrzuca usunięcie własnego konta requestera', async () => {
      await expect(service.deleteUser('org-a', 'user-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(runInOrgContext).not.toHaveBeenCalled();
      expect(userDelete).not.toHaveBeenCalled();
    });

    it('usuwa innego użytkownika tej samej organizacji', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-2', organizationId: 'org-a' });

      await service.deleteUser('org-a', 'user-1', 'user-2');

      expect(userFindFirst).toHaveBeenCalledWith({ where: { id: 'user-2', organizationId: 'org-a' } });
      expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user-2' } });
    });
  });
});
