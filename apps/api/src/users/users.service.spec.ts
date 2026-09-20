import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { InviteNoticeMailLimiter } from '../auth/registration-mail-limiter';
import { AddressClaimService } from './address-claim.service';

describe('UsersService', () => {
  let service: UsersService;
  let runInOrgContext: jest.Mock;
  let organizationFindUnique: jest.Mock;
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
  let noticeCount: jest.Mock;
  let noticeCreate: jest.Mock;
  let claimForOrganization: jest.Mock;
  let tryAcquireMail: jest.Mock;

  beforeEach(async () => {
    organizationFindUnique = jest.fn().mockResolvedValue({ name: 'firma.pl', seatsLimit: 1000 });
    departmentFindFirst = jest.fn();
    departmentUpsert = jest.fn();
    userCreate = jest.fn();
    userFindFirst = jest.fn();
    userDelete = jest.fn();
    userUpdate = jest.fn();
    userCount = jest.fn().mockResolvedValue(0); // domyślnie: brak kont (limit licencji nie jest przedmiotem większości testów)
    tokenCount = jest.fn().mockResolvedValue(0);
    tokenFindFirst = jest.fn().mockResolvedValue(null);
    issuePasswordResetUrl = jest.fn().mockResolvedValue('http://localhost:3000/reset-password?token=abc');
    sendEmail = jest.fn().mockResolvedValue(undefined);
    noticeCount = jest.fn().mockResolvedValue(0);
    noticeCreate = jest.fn().mockResolvedValue({});
    claimForOrganization = jest.fn().mockResolvedValue('TAKEN');
    tryAcquireMail = jest.fn().mockResolvedValue(true);

    runInOrgContext = jest.fn((_organizationId: string, fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: jest.fn().mockResolvedValue(0), // blokada doradcza licencji
        organization: { findUnique: organizationFindUnique },
        passwordResetToken: { count: tokenCount, findFirst: tokenFindFirst },
        inviteNotice: { count: noticeCount, create: noticeCreate },
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
        { provide: AddressClaimService, useValue: { claimForOrganization: claimForOrganization } },
        { provide: InviteNoticeMailLimiter, useValue: { tryAcquire: tryAcquireMail } },
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
  });

  describe('adres zajęty (users.email jest unikalny globalnie)', () => {
    const dto = { email: 'ktos@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE' as never };
    const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { modelName: 'User' } });
    const created = { id: 'user-1', email: 'ktos@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE', status: 'INVITED', createdAt: new Date(), department: null };

    it('konto w TEJ organizacji: ogólny błąd 400, bez powiadomienia i bez próby przejęcia', async () => {
      userCreate.mockRejectedValue(p2002());
      userFindFirst.mockResolvedValue({ id: 'own' });

      await expect(service.inviteUser('org-a', dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(claimForOrganization).not.toHaveBeenCalled();
      expect(noticeCreate).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('adres w INNEJ organizacji: odpowiedź jak dla nowego adresu (INVITED, inviteEmailSent), konta nie tworzy, właściciel dostaje powiadomienie', async () => {
      userCreate.mockRejectedValue(p2002());
      userFindFirst.mockResolvedValue(null);
      claimForOrganization.mockResolvedValue('TAKEN');

      const result = await service.inviteUser('org-a', dto);

      expect(result).toMatchObject({ email: 'ktos@test.pl', firstName: 'Jan', lastName: 'K', role: 'EMPLOYEE', status: 'INVITED', inviteEmailSent: true, department: null });
      expect(result.id).toMatch(/^c[a-z0-9]{24}$/);
      expect(userCreate).toHaveBeenCalledTimes(1);
      expect(issuePasswordResetUrl).not.toHaveBeenCalled();
      expect(noticeCreate).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ktos@test.pl', templateName: 'invite-address-taken' }));
    });

    it('powiadomienie idzie do dziennika (limit dobowy) także wtedy, gdy skrzynka jest chroniona limitem "jedna wiadomość na 10 minut"', async () => {
      userCreate.mockRejectedValue(p2002());
      userFindFirst.mockResolvedValue(null);
      tryAcquireMail.mockResolvedValue(false);

      const result = await service.inviteUser('org-a', dto);

      expect(result.inviteEmailSent).toBe(true);
      expect(noticeCreate).toHaveBeenCalledTimes(1);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('organizacja ze zweryfikowaną domeną przejmuje adres od nieaktywowanego zaproszenia: konto powstaje normalnie, zwykłe zaproszenie', async () => {
      userCreate.mockRejectedValueOnce(p2002()).mockResolvedValueOnce(created);
      userFindFirst.mockResolvedValue(null);
      claimForOrganization.mockResolvedValue('CLAIMED');

      const result = await service.inviteUser('org-a', dto);

      expect(result).toMatchObject({ id: 'user-1', inviteEmailSent: true });
      expect(noticeCreate).not.toHaveBeenCalled();
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'user-invite' }));
    });

    it('przejęcie się udało, ale adres zajęto ponownie (wyścig): traktowany jak zajęty (powiadomienie, brak konta)', async () => {
      userCreate.mockRejectedValue(p2002());
      userFindFirst.mockResolvedValue(null);
      claimForOrganization.mockResolvedValue('CLAIMED');

      const result = await service.inviteUser('org-a', dto);

      expect(result.inviteEmailSent).toBe(true);
      expect(noticeCreate).toHaveBeenCalledTimes(1);
    });

    it('limit dobowy liczy powiadomienia razem z tokenami zaproszeń (sondowanie adresów nie omija limitu)', async () => {
      tokenCount.mockResolvedValue(200);
      noticeCount.mockResolvedValue(100);

      await expect(service.inviteUser('org-a', dto)).rejects.toMatchObject({ status: 429 });
      expect(userCreate).not.toHaveBeenCalled();
    });
  });

  describe('odporność zaproszenia na awarię tokenu', () => {
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
