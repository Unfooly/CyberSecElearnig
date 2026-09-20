import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus } from '@prisma/client';
import { Role } from '@cyberszkolo/shared';
import { CLAIM_TOKEN_TTL_MS } from '../auth/claim-ttl';
import { EmailService } from '../email/email.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const PENDING_ORGANIZATION_CLEANUP_JOB = 'pending-organization-cleanup';
// Codziennie o 03:00 UTC.
const CLEANUP_CRON = '0 3 * * *';

export const WARNING_AFTER_DAYS = 7;
export const DELETE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  deleted: number;
  warned: number;
}

/**
 * Sprzątanie organizacji, które nie zweryfikowały domeny (PENDING):
 * - po 7 dniach od rejestracji: JEDEN mail ostrzegawczy do adminów
 *   (unverifiedWarningSentAt zajmowane atomowo - dwa równoległe uruchomienia
 *   nie wyślą go dwa razy),
 * - po 14 dniach: trwałe usunięcie organizacji (kaskadowo z danymi).
 * Organizacje ACTIVE nigdy nie są ruszane - status jest sprawdzany w samym
 * warunku zapisu/usunięcia, więc weryfikacja domeny w trakcie działania
 * joba wygrywa.
 *
 * `now` jest parametrem (testy z zamrożonym zegarem). Tabela organizations
 * jest globalna (bez RLS), użytkownicy adminów czytani są w kontekście
 * konkretnej organizacji - to zadanie NIE używa żadnej furtki omijającej RLS.
 */
@Injectable()
export class PendingOrganizationCleanupService implements OnModuleInit {
  private readonly logger = new Logger(PendingOrganizationCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerRecurring({
      name: PENDING_ORGANIZATION_CLEANUP_JOB,
      cron: CLEANUP_CRON,
      handler: () => this.run(),
    });
  }

  async run(now: Date = new Date()): Promise<CleanupResult> {
    // Najpierw usuwanie: organizacja po terminie nie dostaje już ostrzeżenia.
    const deleted = await this.deleteExpired(now);
    const claims = await this.purgeExpiredClaims(now);
    const warned = await this.warnDue(now);
    this.logger.log(`Sprzątanie organizacji PENDING: usunięto ${deleted}, ostrzeżono ${warned}, wygasłe potwierdzenia rejestracji ${claims.claims} (organizacje bez admina: ${claims.organizations})`);
    return { deleted, warned };
  }

  /**
   * Natychmiastowe usunięcie organizacji PENDING (kaskadowo z danymi) - ten sam mechanizm i ten sam warunek statusu w samym DELETE
   * co w sprzątaniu po 14 dniach, tylko bez czekania: dla organizacji, która straciła jedynego (niepotwierdzonego) administratora,
   * bo adres przejęła organizacja ze zweryfikowaną domeną. Organizacja ACTIVE nigdy nie jest ruszana. true = usunięto.
   */
  async deleteNow(organizationId: string): Promise<boolean> {
    // W kontekście TEJ organizacji: filtr po relacji `users` idzie pod RLS, więc widzi jej konta. Poza kontekstem (RLS fail-closed)
    // ta relacja byłaby pusta i warunek "nikt nie aktywował konta" byłby zawsze prawdziwy, czyli nic nie chroniłby.
    const result = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.organization.deleteMany({
        where: {
          id: organizationId,
          status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION,
          // W samym DELETE: nikt z tej organizacji nie zdążył aktywować konta (aktywacja w trakcie = nie ruszamy).
          users: { none: { OR: [{ status: { not: 'INVITED' } }, { emailVerifiedAt: { not: null } }] } },
        },
      }),
    );
    return result.count === 1;
  }

  /**
   * Wygasłe wpisy `pending_admin_claims` (rejestracja na adres z cudzym zaproszeniem, link niekliknięty w 24 h) są kasowane, a
   * organizacja-widmo, która nie ma admina ani innych kont ani niewygasłych wpisów, jest usuwana razem z danymi do faktury
   * (`deleteNow`). Tabele klienckie czytane per organizacja (RLS) - nie da się tego zrobić jednym zapytaniem po relacji z
   * `organizations`, bo poza kontekstem RLS nie widzi wierszy. Idempotentne; błąd jednej organizacji nie blokuje reszty.
   */
  async purgeExpiredClaims(now: Date = new Date()): Promise<{ claims: number; organizations: number }> {
    const result = { claims: 0, organizations: 0 };
    let afterId: string | null = null;
    for (;;) {
      const page: { id: string }[] = await this.prisma.organization.findMany({
        where: {
          status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION,
          // Wpis powstaje razem z organizacją i wygasa po CLAIM_TOKEN_TTL_MS, więc wygasły wpis może być tylko w organizacji starszej
          // niż ta wartość: świeżych PENDING (większość) nie skanujemy. (Filtr po relacji do pending_admin_claims/users odpada: poza
          // kontekstem RLS relacje są puste.)
          createdAt: { lte: new Date(now.getTime() - CLAIM_TOKEN_TTL_MS) },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 200,
      });
      if (page.length === 0) break;
      afterId = page[page.length - 1].id;
      for (const { id } of page) {
        try {
          const outcome = await this.tenantPrisma.runInOrgContext(id, async (tx) => {
            const deleted = await tx.pendingAdminClaim.deleteMany({ where: { organizationId: id, expiresAt: { lte: now } } });
            if (deleted.count === 0) return { deleted: 0, orphan: false };
            const [claims, users] = await Promise.all([
              tx.pendingAdminClaim.count({ where: { organizationId: id } }),
              tx.user.count({ where: { organizationId: id } }),
            ]);
            return { deleted: deleted.count, orphan: claims === 0 && users === 0 };
          });
          result.claims += outcome.deleted;
          if (outcome.orphan && (await this.deleteNow(id))) result.organizations += 1;
        } catch (error) {
          this.logger.error(`Sprzątanie wygasłych potwierdzeń rejestracji nie powiodło się (organizacja ${id}): ${(error as Error).name}`);
        }
      }
    }
    return result;
  }

  private cutoff(now: Date, days: number): Date {
    return new Date(now.getTime() - days * DAY_MS);
  }

  private async deleteExpired(now: Date): Promise<number> {
    const cutoff = this.cutoff(now, DELETE_AFTER_DAYS);
    const expired = await this.prisma.organization.findMany({
      where: { status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION, createdAt: { lte: cutoff } },
      select: { id: true },
    });

    let deleted = 0;
    for (const { id } of expired) {
      try {
        // Warunek statusu w samym DELETE: domena zweryfikowana w międzyczasie = nie ruszamy.
        const result = await this.prisma.organization.deleteMany({
          where: { id, status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION, createdAt: { lte: cutoff } },
        });
        deleted += result.count;
      } catch (error) {
        this.logger.error(`Nie udało się usunąć organizacji ${id}: ${(error as Error).message}`);
      }
    }
    return deleted;
  }

  private async warnDue(now: Date): Promise<number> {
    const warnCutoff = this.cutoff(now, WARNING_AFTER_DAYS);
    const deleteCutoff = this.cutoff(now, DELETE_AFTER_DAYS);
    const due = await this.prisma.organization.findMany({
      where: {
        status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION,
        unverifiedWarningSentAt: null,
        createdAt: { lte: warnCutoff, gt: deleteCutoff },
      },
      select: { id: true, name: true, createdAt: true },
    });

    let warned = 0;
    for (const organization of due) {
      try {
        if (await this.warn(organization, now)) {
          warned += 1;
        }
      } catch (error) {
        this.logger.error(`Nie udało się ostrzec organizacji ${organization.id}: ${(error as Error).message}`);
      }
    }
    return warned;
  }

  private async warn(organization: { id: string; name: string; createdAt: Date }, now: Date): Promise<boolean> {
    // Zajęcie "slotu" PRZED wysyłką: równoległe uruchomienie dostanie count 0.
    const claim = await this.prisma.organization.updateMany({
      where: {
        id: organization.id,
        status: OrganizationStatus.PENDING_DOMAIN_VERIFICATION,
        unverifiedWarningSentAt: null,
      },
      data: { unverifiedWarningSentAt: now },
    });
    if (claim.count === 0) {
      return false;
    }

    // Semantyka "co najwyżej raz": po zajęciu slotu awaria PROCESU (kill, deploy)
    // przed wysyłką zgubi ostrzeżenie - świadomy kompromis (alternatywa to
    // ryzyko duplikatów). Błędy w obrębie biegu (odczyt adminów, wysyłka) są
    // obsłużone niżej: slot wraca, gdy NIKT nie dostał maila.
    let sent = 0;
    let admins: { email: string }[] = [];
    try {
      admins = await this.tenantPrisma.runInOrgContext(organization.id, (tx) =>
        tx.user.findMany({
          where: { organizationId: organization.id, role: Role.ORG_ADMIN },
          select: { email: true },
        }),
      );

      const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      const deleteOn = new Date(organization.createdAt.getTime() + DELETE_AFTER_DAYS * DAY_MS).toLocaleDateString('pl-PL', {
        timeZone: 'UTC',
      });

      for (const admin of admins) {
        // Osobny try na admina: błąd jednego nie odbiera maila pozostałym.
        try {
          const accepted = await this.emailService.send({
            to: admin.email,
            subject: 'Dokończ weryfikację domeny - organizacja zostanie usunięta',
            templateName: 'pending-organization-warning',
            templateData: { organizationName: organization.name, deleteOn, loginUrl: `${frontendUrl}/login` },
          });
          if (accepted !== false) {
            sent += 1;
          }
        } catch (error) {
          this.logger.error(`Błąd wysyłki ostrzeżenia (organizacja ${organization.id}): ${(error as Error).message}`);
        }
      }
    } catch (error) {
      await this.releaseClaim(organization.id, now);
      throw error;
    }

    if (admins.length > 0 && sent === 0) {
      // Nikt nie dostał maila: zwalniamy slot, następny bieg ponowi. Gdy choć jeden
      // admin dostał, slot zostaje - ponowna wysyłka dublowałaby mail.
      await this.releaseClaim(organization.id, now);
      return false;
    }
    return true;
  }

  // Zwalnia tylko slot zajęty przez TEN bieg (wartość = jego `now`).
  private async releaseClaim(id: string, claimedAt: Date): Promise<void> {
    await this.prisma.organization.updateMany({
      where: { id, unverifiedWarningSentAt: claimedAt },
      data: { unverifiedWarningSentAt: null },
    });
  }
}
