import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ResellersService } from './resellers.service';

describe('ResellersService', () => {
  let organizationFindUnique: jest.Mock;
  let organizationFindMany: jest.Mock;
  let organizationCreate: jest.Mock;
  let assignmentCreate: jest.Mock;
  let assignmentDeleteMany: jest.Mock;
  let assignmentFindMany: jest.Mock;
  let inviteUser: jest.Mock;
  let service: ResellersService;

  beforeEach(() => {
    organizationFindUnique = jest.fn();
    organizationFindMany = jest.fn().mockResolvedValue([]);
    organizationCreate = jest.fn().mockResolvedValue({ id: 'res-1', name: 'IT Partner', createdAt: new Date('2026-09-22T10:00:00Z') });
    assignmentCreate = jest.fn().mockResolvedValue({});
    assignmentDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    assignmentFindMany = jest.fn().mockResolvedValue([]);
    inviteUser = jest.fn().mockResolvedValue({});

    service = new ResellersService(
      {
        organization: { findUnique: organizationFindUnique, findMany: organizationFindMany, create: organizationCreate },
        resellerAssignment: {
          create: assignmentCreate,
          deleteMany: assignmentDeleteMany,
          findMany: assignmentFindMany,
        },
      } as unknown as PrismaService,
      { inviteUser } as unknown as UsersService,
    );
  });

  describe('createReseller', () => {
    it('zakłada organizację partnera jako ACTIVE i zaprasza jej administratora z rolą RESELLER_ADMIN', async () => {
      const result = await service.createReseller(
        { name: 'IT Partner', adminEmail: 'anna@partner.test', adminFirstName: 'Anna', adminLastName: 'Nowak' },
        'operator@unfooly.test',
      );

      // Organizację partnera tworzy operator świadomie - nie przechodzi weryfikacji domeny.
      expect(organizationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: 'RESELLER', status: 'ACTIVE' }) }),
      );
      expect(inviteUser).toHaveBeenCalledWith('res-1', expect.objectContaining({ role: Role.RESELLER_ADMIN }));
      expect(result).toEqual(expect.objectContaining({ id: 'res-1', clientCount: 0, createdByEmail: 'operator@unfooly.test' }));
    });
  });

  describe('assignOrganization', () => {
    it('przypisuje organizację kliencką i zapisuje adres operatora', async () => {
      organizationFindUnique.mockResolvedValueOnce({ kind: 'RESELLER' }).mockResolvedValueOnce({ kind: 'CLIENT' });

      await service.assignOrganization('res-1', 'org-1', 'operator@unfooly.test');

      expect(assignmentCreate).toHaveBeenCalledWith({
        data: { resellerOrganizationId: 'res-1', organizationId: 'org-1', assignedByEmail: 'operator@unfooly.test' },
      });
    });

    it('odrzuca przypisanie do czegoś, co nie jest resellerem', async () => {
      organizationFindUnique.mockResolvedValueOnce({ kind: 'CLIENT' });

      await expect(service.assignOrganization('org-2', 'org-1', 'operator@unfooly.test')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(assignmentCreate).not.toHaveBeenCalled();
    });

    it('odrzuca przypisanie organizacji, która sama jest resellerem', async () => {
      organizationFindUnique.mockResolvedValueOnce({ kind: 'RESELLER' }).mockResolvedValueOnce({ kind: 'RESELLER' });

      await expect(service.assignOrganization('res-1', 'res-2', 'operator@unfooly.test')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(assignmentCreate).not.toHaveBeenCalled();
    });

    it('nieistniejąca organizacja => 404, bez zapisu', async () => {
      organizationFindUnique.mockResolvedValueOnce({ kind: 'RESELLER' }).mockResolvedValueOnce(null);

      await expect(service.assignOrganization('res-1', 'brak', 'operator@unfooly.test')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(assignmentCreate).not.toHaveBeenCalled();
    });

    it('jeden opiekun na klienta: druga próba kończy się konfliktem, nie cichym nadpisaniem', async () => {
      organizationFindUnique.mockResolvedValueOnce({ kind: 'RESELLER' }).mockResolvedValueOnce({ kind: 'CLIENT' });
      assignmentCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );

      await expect(service.assignOrganization('res-1', 'org-1', 'operator@unfooly.test')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('unassignOrganization', () => {
    it('odłącza parę reseller-organizacja', async () => {
      await service.unassignOrganization('res-1', 'org-1');

      expect(assignmentDeleteMany).toHaveBeenCalledWith({ where: { resellerOrganizationId: 'res-1', organizationId: 'org-1' } });
    });

    it('brak takiego przypisania => 404 (nie udajemy sukcesu)', async () => {
      assignmentDeleteMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.unassignOrganization('res-1', 'org-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listClients', () => {
    it('filtruje WYŁĄCZNIE po organizacji partnera z tokena i zwraca same metadane organizacji', async () => {
      assignmentFindMany.mockResolvedValueOnce([
        {
          assignedAt: new Date('2026-09-22T10:00:00Z'),
          organization: { id: 'org-1', name: 'Klient', status: 'ACTIVE', plan: 'TRIAL', seatsLimit: 10 },
        },
      ]);

      const clients = await service.listClients('res-1');

      expect(assignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { resellerOrganizationId: 'res-1' } }));
      // Żadnych danych pracowników ani wyników - tylko metadane organizacji.
      expect(clients).toEqual([
        {
          id: 'org-1',
          name: 'Klient',
          status: 'ACTIVE',
          plan: 'TRIAL',
          seatsLimit: 10,
          assignedAt: '2026-09-22T10:00:00.000Z',
        },
      ]);
    });
  });

});
