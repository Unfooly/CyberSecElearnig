import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { DnsTxtResolver } from './dns-txt-resolver';

export const DOMAIN_VERIFICATION_HOST_PREFIX = '_unfooly-verify.';
export const DOMAIN_VERIFICATION_VALUE_PREFIX = 'unfooly-verify=';
const CHECK_COOLDOWN_MS = 10_000;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// JEDEN, ogólny błąd dla WSZYSTKICH nieudanych weryfikacji: zły token, brak
// rekordu, timeout DNS, NXDOMAIN, a także domena już zweryfikowana w innej
// organizacji. Odpowiedź nie może zdradzać, kto ma domenę.
export const DOMAIN_VERIFICATION_FAILED = {
  code: 'DOMAIN_VERIFICATION_FAILED',
  message:
    'Nie udało się zweryfikować domeny. Sprawdź, czy rekord DNS został dodany dokładnie tak, jak podano, i spróbuj ponownie za kilka minut (propagacja DNS może potrwać).',
};

export const DOMAIN_CHECK_TOO_FREQUENT = {
  code: 'DOMAIN_CHECK_TOO_FREQUENT',
  message: 'Sprawdzenie domeny można powtórzyć za kilka sekund.',
};

/**
 * Weryfikacja własności domeny e-maila admina rekordem DNS TXT:
 *   _unfooly-verify.<domena> = "unfooly-verify=<token>".
 *
 * TO JEDYNE MIEJSCE, które ustawia OrganizationDomain.verifiedAt i przełącza
 * organizację na ACTIVE - nigdzie indziej (ani w kontrolerach, ani w
 * rejestracji) nie wolno tego robić.
 */
@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly dnsResolver: DnsTxtResolver,
  ) {}

  /** Dokładny rekord, który admin ma wkleić do DNS. */
  static expectedRecord(domain: string, token: string) {
    return {
      type: 'TXT' as const,
      host: `${DOMAIN_VERIFICATION_HOST_PREFIX}${domain}`,
      value: `${DOMAIN_VERIFICATION_VALUE_PREFIX}${token}`,
    };
  }

  async check(organizationId: string): Promise<{ verified: true }> {
    const row = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.organizationDomain.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    );
    if (!row) {
      throw new BadRequestException(DOMAIN_VERIFICATION_FAILED);
    }
    if (row.verifiedAt) {
      return { verified: true };
    }

    // Cooldown per organizacja, atomowo (UPDATE z warunkiem): dwa równoległe
    // kliknięcia nie zrobią dwóch zapytań DNS.
    const now = Date.now();
    const claimed = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.organizationDomain.updateMany({
        where: {
          id: row.id,
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - CHECK_COOLDOWN_MS) } }],
        },
        data: { lastCheckedAt: new Date(now) },
      }),
    );
    if (claimed.count === 0) {
      throw new HttpException(DOMAIN_CHECK_TOO_FREQUENT, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!(await this.recordMatches(row.domain, row.verificationToken))) {
      throw new BadRequestException(DOMAIN_VERIFICATION_FAILED);
    }

    try {
      await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
        const updated = await tx.organizationDomain.updateMany({
          where: { id: row.id, verifiedAt: null },
          data: { verifiedAt: new Date() },
        });
        if (updated.count === 0) {
          // Równoległe kliknięcie zdążyło pierwsze - stan końcowy ten sam.
          return;
        }
        await tx.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
      });
    } catch (error) {
      // Domena zweryfikowana już przez INNĄ organizację (partial unique index):
      // ten sam ogólny błąd co przy braku rekordu, bez informacji, kto ją ma.
      // Transakcja wycofała też zmianę statusu. Do logu tylko kod, bez meta.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        this.logger.warn('Weryfikacja domeny: domena jest już zweryfikowana w innej organizacji.');
        throw new BadRequestException(DOMAIN_VERIFICATION_FAILED);
      }
      throw error;
    }
    return { verified: true };
  }

  /** true tylko, gdy w DNS jest dokładnie oczekiwany rekord; każdy błąd DNS = false. */
  private async recordMatches(domain: string, token: string): Promise<boolean> {
    const { host, value } = DomainVerificationService.expectedRecord(domain, token);
    let records: string[][];
    try {
      records = await this.dnsResolver.resolveTxt(host);
    } catch {
      return false;
    }
    // Długi TXT bywa rozbity na fragmenty - łączymy je w jedną wartość.
    return records.some((chunks) => chunks.join('') === value);
  }
}
