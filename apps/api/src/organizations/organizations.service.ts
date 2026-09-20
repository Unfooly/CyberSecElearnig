import { BadRequestException, Injectable } from '@nestjs/common';
import { canonicalTimeZone } from '../common/validators/iana-time-zone.validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { DomainVerificationService } from './domain-verification.service';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';

export const SELF_JOIN_REQUIRES_VERIFIED_DOMAIN = {
  code: 'DOMAIN_NOT_VERIFIED',
  message: 'Samodzielne dołączanie pracowników można włączyć dopiero po zweryfikowaniu domeny.',
};

export interface OrganizationOverview {
  id: string;
  name: string;
  status: 'PENDING_DOMAIN_VERIFICATION' | 'ACTIVE';
  selfJoinEnabled: boolean;
  // Strefa czasowa organizacji (IANA) - wg niej UI formatuje daty.
  timezone: string;
  // Dane firmy z rejestracji (tylko do odczytu w ustawieniach); null dla organizacji sprzed modelu samoobsługowego.
  billing: {
    legalName: string;
    taxId: string;
    addressLine: string;
    postalCode: string;
    city: string;
    country: string;
  } | null;
  domain: {
    name: string;
    verified: boolean;
    verifiedAt: Date | null;
    lastCheckedAt: Date | null;
    // Dokładny rekord do wklejenia w DNS.
    txtRecord: { type: 'TXT'; host: string; value: string };
  } | null;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Stan organizacji + rekord DNS do weryfikacji. `organizationId` wyłącznie z JWT. */
  async getOverview(organizationId: string): Promise<OrganizationOverview> {
    return this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { id: true, name: true, status: true, selfJoinEnabled: true, timezone: true },
      });
      const domain = await tx.organizationDomain.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });
      const billing = await tx.organizationBillingDetails.findUnique({
        where: { organizationId },
        select: { legalName: true, taxId: true, addressLine: true, postalCode: true, city: true, country: true },
      });
      return {
        ...organization,
        billing,
        domain: domain
          ? {
              name: domain.domain,
              verified: domain.verifiedAt !== null,
              verifiedAt: domain.verifiedAt,
              lastCheckedAt: domain.lastCheckedAt,
              txtRecord: DomainVerificationService.expectedRecord(domain.domain, domain.verificationToken),
            }
          : null,
      };
    });
  }

  async updateSettings(organizationId: string, dto: UpdateOrganizationSettingsDto): Promise<OrganizationOverview> {
    await this.tenantPrisma.runInOrgContext(organizationId, async (tx) => {
      if (dto.selfJoinEnabled === true) {
        // Włączenie tylko przy zweryfikowanej domenie (status ACTIVE i wiersz z verifiedAt).
        const verified = await tx.organizationDomain.findFirst({
          where: { organizationId, verifiedAt: { not: null } },
          select: { id: true },
        });
        if (!verified) {
          throw new BadRequestException(SELF_JOIN_REQUIRES_VERIFIED_DOMAIN);
        }
      }
      // Jawny warunek na id organizacji z JWT (tabela organizations nie ma RLS).
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.selfJoinEnabled !== undefined ? { selfJoinEnabled: dto.selfJoinEnabled } : {}),
          // Nazwa kanoniczna (walidator już potwierdził, że strefa istnieje).
          ...(dto.timezone !== undefined ? { timezone: canonicalTimeZone(dto.timezone) ?? undefined } : {}),
        },
      });
    });
    return this.getOverview(organizationId);
  }
}
