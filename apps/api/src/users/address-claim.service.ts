import { Injectable, Logger, Module } from '@nestjs/common';
import { User } from '@prisma/client';
import { emailDomain } from '../organizations/domain.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InvitedAccountChangedError, NEVER_ACTIVATED, expireInvitedAccounts } from './invited-accounts';

export type AddressClaim = 'CLAIMED' | 'TAKEN';

/**
 * Pierwszeństwo do adresu e-mail (users.email jest unikalny GLOBALNIE, a zaproszenie może obejść cudzą skrzynkę):
 *
 *  - konto ZAKTYWOWANE nigdy nie jest przejmowane;
 *  - konto INVITED (nieaktywowane zaproszenie) w obcej organizacji NIE blokuje adresu dwóm rodzajom wnioskodawców:
 *    1) organizacji ze ZWERYFIKOWANĄ (DNS TXT) domeną tego adresu - przy zaproszeniu/imporcie (`claimForOrganization`),
 *    2) rejestracji nowej organizacji, gdy organizacja-właściciel zaproszenia sama NIE ma zweryfikowanej domeny tego adresu, czyli
 *       zaprosiła cudzy adres bez żadnych praw do jego domeny (`displaceUnprotectedForRegistration`). Konto zaproszone przez
 *       organizację z zweryfikowaną domeną adresu jest chronione.
 *  - konto ORG_ADMIN nie jest przejmowane (organizacja nie zostałaby bez administratora).
 * Przejęcie usuwa cudze zaproszenie (jego administrator widzi status "wygasło" - bez informacji, kto przejął adres).
 *
 * Odczyt cudzego konta idzie przez istniejący wyjątek `runAuthLookup` (użytkownik po globalnym e-mailu; wynik służy WYŁĄCZNIE do tej
 * decyzji i nigdy nie jest zwracany klientowi); zapis (usunięcie) przez `runInOrgContext(organizacja właściciela)`, bez omijania RLS.
 */
@Injectable()
export class AddressClaimService {
  private readonly logger = new Logger(AddressClaimService.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Czy organizacja ma ZWERYFIKOWANĄ domenę tego adresu (dokładne dopasowanie, bez subdomen). */
  async hasVerifiedDomainOf(organizationId: string, email: string): Promise<boolean> {
    const domain = emailDomain(email);
    if (!domain) return false;
    const found = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.organizationDomain.findFirst({ where: { organizationId, domain, verifiedAt: { not: null } }, select: { id: true } }),
    );
    return found !== null;
  }

  /**
   * Zaproszenie/import z organizacji `organizationId` na adres zajęty gdzieś indziej: CLAIMED = adres wolny (przejęty od
   * nieaktywowanego zaproszenia albo zwolnił się w międzyczasie), można tworzyć konto; TAKEN = adres zajęty i nieprzejmowalny.
   */
  async claimForOrganization(organizationId: string, email: string, now: Date = new Date()): Promise<AddressClaim> {
    if (!(await this.hasVerifiedDomainOf(organizationId, email))) return 'TAKEN';
    const owner = await this.tenantPrisma.runAuthLookup({ email });
    if (!owner) return 'CLAIMED';
    if (owner.organizationId === organizationId || !this.isDisplaceable(owner)) return 'TAKEN';
    return (await this.expire(owner, now)) ? 'CLAIMED' : 'TAKEN';
  }

  /**
   * Rejestracja nowej organizacji na adres z nieaktywowanym zaproszeniem w obcej organizacji, która nie ma zweryfikowanej domeny tego
   * adresu: zaproszenie jest usuwane, a rejestracja przebiega normalnie. true = adres zwolniony.
   */
  async displaceUnprotectedForRegistration(existing: User, now: Date = new Date()): Promise<boolean> {
    if (!this.isDisplaceable(existing)) return false;
    if (await this.hasVerifiedDomainOf(existing.organizationId, existing.email)) return false;
    return this.expire(existing, now);
  }

  private isDisplaceable(user: User): boolean {
    return user.status === NEVER_ACTIVATED.status && user.emailVerifiedAt === null && user.role !== 'ORG_ADMIN';
  }

  private async expire(owner: User, now: Date): Promise<boolean> {
    try {
      const count = await this.tenantPrisma.runInOrgContext(owner.organizationId, (tx) => expireInvitedAccounts(tx, owner.organizationId, [owner.id], now));
      return count === 1;
    } catch (error) {
      if (error instanceof InvitedAccountChangedError) return false;
      this.logger.error(`Przejęcie adresu nie powiodło się: ${(error as Error).name}`);
      return false;
    }
  }
}

@Module({ providers: [AddressClaimService], exports: [AddressClaimService] })
export class AddressClaimModule {}
