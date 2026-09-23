import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationKind, OrganizationStatus, Prisma } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsersService } from '../users/users.service';
import { CreateResellerDto } from './dto/create-reseller.dto';
import { ResellerDto } from './dto/reseller.dto';
import { ResellerClientDto } from './dto/reseller-client.dto';
import { AssignableOrganizationDto } from './dto/assignable-organization.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Reseller obsługuje swoich ludzi, nie pracowników klienta - kilka miejsc wystarczy.
const RESELLER_SEATS_LIMIT = 5;

/**
 * Panel resellera, krok 1 (D-070, zgłoszenie B-092).
 *
 * Partner jest ZWYKŁĄ organizacją z `kind = RESELLER`, więc logowanie, sesje, zaproszenia i RLS
 * działają bez nowego mechanizmu. Ten serwis dotyka WYŁĄCZNIE dwóch tabel globalnych
 * (`organizations`, `reseller_assignments`) - tych samych, które są poza RLS z definicji - więc
 * nie potrzebuje i NIE UŻYWA żadnego obejścia RLS (`runCrossOrgQuery`). Danych klienckich
 * (użytkownicy, kursy, kampanie) nie czyta w ogóle: wejście w organizację klienta to osobny,
 * jeszcze niezbudowany krok z tokenem zakresowanym i audytem.
 */
@Injectable()
export class ResellersService {
  constructor(
    private readonly prisma: PrismaService,
    // Wyłącznie do sprawdzenia, czy konto administratora partnera powstało w JEGO organizacji
    // (users jest pod RLS, więc bez kontekstu organizacji zapytanie nic by nie zwróciło).
    private readonly tenantPrisma: TenantPrismaService,
    private readonly users: UsersService,
  ) {}

  /** Lista partnerów dla panelu operatora (SUPER_ADMIN - rolę sprawdza kontroler). */
  async listResellers(): Promise<ResellerDto[]> {
    // Liczymy WYŁĄCZNIE klientów (`reseller_assignments` - tabela globalna). Liczba użytkowników
    // partnera celowo nie jest tu pokazywana: `users` jest pod RLS, więc zapytanie bez kontekstu
    // organizacji i tak zwróciłoby 0 (sprawdzone w e2e), a wchodzenie w kontekst każdego partnera
    // po to, by policzyć konta, to praca dla kroku 2 („wejdź jako organizacja”).
    const resellers = await this.prisma.organization.findMany({
      where: { kind: OrganizationKind.RESELLER },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { resellerClients: true } },
      },
      orderBy: { name: 'asc' },
    });

    return resellers.map((reseller) => ({
      id: reseller.id,
      name: reseller.name,
      createdAt: reseller.createdAt.toISOString(),
      clientCount: reseller._count.resellerClients,
    }));
  }

  /**
   * Zakłada organizację partnera i zaprasza jej pierwszego administratora.
   * Organizacja resellera powstaje od razu jako ACTIVE: tworzy ją operator świadomie,
   * więc nie przechodzi weryfikacji domeny (ta pilnuje samoobsługowych rejestracji).
   */
  async createReseller(dto: CreateResellerDto, actorEmail: string): Promise<ResellerDto> {
    const reseller = await this.prisma.organization.create({
      data: {
        name: dto.name,
        kind: OrganizationKind.RESELLER,
        status: OrganizationStatus.ACTIVE,
        seatsLimit: RESELLER_SEATS_LIMIT,
      },
      select: { id: true, name: true, createdAt: true },
    });

    // Ten sam, przetestowany mechanizm co zapraszanie pracownika (konto INVITED + link do
    // ustawienia hasła). Rola RESELLER_ADMIN nie jest na liście ASSIGNABLE_ROLES, więc admin
    // organizacji klienckiej nie nada jej nikomu - nadaje ją wyłącznie ta ścieżka.
    const invited = await this.users.inviteUser(reseller.id, {
      email: dto.adminEmail,
      firstName: dto.adminFirstName,
      lastName: dto.adminLastName,
      role: Role.RESELLER_ADMIN,
    });

    // `inviteUser` przy adresie zajętym w INNEJ organizacji świadomie NIE rzuca błędu, tylko
    // zwraca odpowiedź nie do odróżnienia od sukcesu (anty-enumeracja dla administratorów
    // klienta). Tutaj nie wolno tego zostawić: operator dostałby 201 i partnera, do którego
    // nikt nigdy się nie zaloguje, bez ścieżki naprawy. Sprawdzamy więc, czy konto FAKTYCZNIE
    // powstało w organizacji partnera, i jeśli nie - kasujemy świeżo utworzoną organizację
    // (nic jeszcze do niej nie należy) i mówimy operatorowi wprost, co się stało. Operator jest
    // zaufany, więc informacja „adres zajęty” nie jest tu wyrocznią dla obcego.
    const adminExists = await this.tenantPrisma.runInOrgContext(reseller.id, (tx) =>
      tx.user.findFirst({ where: { organizationId: reseller.id, email: dto.adminEmail }, select: { id: true } }),
    );
    if (!adminExists) {
      await this.prisma.organization.delete({ where: { id: reseller.id } });
      throw new ConflictException(
        'Ten adres e-mail ma już konto w innej organizacji. Użyj innego adresu dla administratora partnera.',
      );
    }

    return {
      id: reseller.id,
      name: reseller.name,
      createdAt: reseller.createdAt.toISOString(),
      clientCount: 0,
      createdByEmail: actorEmail,
      // false = konto powstało, ale e-mail z zaproszeniem nie wyszedł; operator musi o tym wiedzieć,
      // bo partner nie ma jak poprosić o ponowną wysyłkę (zaproszenia wysyła ORG_ADMIN klienta).
      inviteEmailSent: invited.inviteEmailSent,
    };
  }

  /** Organizacje klienckie, które operator może komuś przypisać (z aktualnym opiekunem, jeśli jest). */
  async listAssignableOrganizations(): Promise<AssignableOrganizationDto[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { kind: OrganizationKind.CLIENT },
      select: {
        id: true,
        name: true,
        status: true,
        resellerAssignment: { select: { resellerOrganizationId: true, reseller: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      status: organization.status,
      resellerId: organization.resellerAssignment?.resellerOrganizationId ?? null,
      resellerName: organization.resellerAssignment?.reseller.name ?? null,
    }));
  }

  /** Przypisanie klienta do partnera. Wyłącznie operator (D-070): klient nie może tego zmienić. */
  async assignOrganization(resellerOrganizationId: string, organizationId: string, actorEmail: string): Promise<void> {
    await this.assertReseller(resellerOrganizationId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { kind: true },
    });
    if (!organization) {
      throw new NotFoundException('Organizacja nie istnieje.');
    }
    if (organization.kind !== OrganizationKind.CLIENT) {
      throw new BadRequestException('Resellerowi można przypisać wyłącznie organizację kliencką.');
    }

    try {
      await this.prisma.resellerAssignment.create({
        data: { resellerOrganizationId, organizationId, assignedByEmail: actorEmail },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        // UNIQUE po organizationId: jeden opiekun na klienta. Zmiana partnera = najpierw odłączenie.
        throw new ConflictException('Ta organizacja ma już przypisanego resellera.');
      }
      throw error;
    }
  }

  /** Odłączenie klienta od partnera - też wyłącznie operator. */
  async unassignOrganization(resellerOrganizationId: string, organizationId: string): Promise<void> {
    const removed = await this.prisma.resellerAssignment.deleteMany({
      where: { resellerOrganizationId, organizationId },
    });
    if (removed.count === 0) {
      throw new NotFoundException('Ta organizacja nie jest przypisana do tego resellera.');
    }
  }

  /**
   * Lista klientów zalogowanego partnera. `resellerOrganizationId` pochodzi WYŁĄCZNIE z tokena
   * (kontroler), nigdy z żądania - partner nie może podejrzeć cudzej listy. Zwracamy tylko
   * metadane organizacji (nazwa, status, plan, licencje): żadnych danych pracowników ani wyników.
   */
  async listClients(resellerOrganizationId: string): Promise<ResellerClientDto[]> {
    const assignments = await this.prisma.resellerAssignment.findMany({
      where: { resellerOrganizationId },
      select: {
        assignedAt: true,
        organization: { select: { id: true, name: true, status: true, plan: true, seatsLimit: true } },
      },
      orderBy: { organization: { name: 'asc' } },
    });

    return assignments.map((assignment) => ({
      id: assignment.organization.id,
      name: assignment.organization.name,
      status: assignment.organization.status,
      plan: assignment.organization.plan,
      seatsLimit: assignment.organization.seatsLimit,
      assignedAt: assignment.assignedAt.toISOString(),
    }));
  }

  // Nazwę opiekuna dla panelu KLIENTA czyta OrganizationsService.getOverview (jedno miejsce,
  // w kontekście organizacji klienta). Świadomie nie dublujemy tego tutaj: przy kroku 2 relacja
  // reseller-klient zyska logikę audytu i uprawnień, a dwa wejścia do niej rozjechałyby się.

  private async assertReseller(resellerOrganizationId: string): Promise<void> {
    const reseller = await this.prisma.organization.findUnique({
      where: { id: resellerOrganizationId },
      select: { kind: true },
    });
    if (!reseller || reseller.kind !== OrganizationKind.RESELLER) {
      throw new NotFoundException('Reseller nie istnieje.');
    }
  }
}
