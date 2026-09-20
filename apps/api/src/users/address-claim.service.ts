import { Injectable, Logger, Module } from '@nestjs/common';
import { User } from '@prisma/client';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PendingOrganizationCleanupService } from '../organizations/pending-organization-cleanup.service';
import { emailDomain } from '../organizations/domain.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InvitedAccountChangedError, NEVER_ACTIVATED, expireInvitedAccounts } from './invited-accounts';

export type AddressClaim = 'CLAIMED' | 'TAKEN';

/**
 * Pierwszeństwo do adresu e-mail (users.email jest unikalny GLOBALNIE, a zaproszenie może obejść cudzą skrzynkę):
 *
 *  - konto ZAKTYWOWANE nigdy nie jest przejmowane;
 *  - konto INVITED (nieaktywowane) w obcej organizacji NIE blokuje adresu dwóm rodzajom wnioskodawców:
 *    1) organizacji ze ZWERYFIKOWANĄ (DNS TXT) domeną tego adresu - przy zaproszeniu/imporcie (`claimForOrganization`). Dotyczy też
 *       niepotwierdzonego ORG_ADMIN-a organizacji PENDING (pre-hijacking: ktoś zarejestrował firmę na cudzy służbowy adres); jeśli
 *       organizacja traci w ten sposób jedynego admina, jest usuwana NATYCHMIAST tym samym mechanizmem co sprzątanie po 14 dniach;
 *    2) rejestracji nowej organizacji, gdy organizacja-właściciel zaproszenia sama NIE ma zweryfikowanej domeny tego adresu, czyli
 *       zaprosiła cudzy adres bez żadnych praw do jego domeny - ale DOPIERO po potwierdzeniu skrzynki przez rejestrującego (klik w
 *       link z maila, `RegistrationService.claimRegistration`, atomowo z utworzeniem admina), nigdy przy samym POST /auth/register.
 *       Tu tylko sprawdzenie `isClaimableByRegistration`. Zaproszenie od organizacji ze zweryfikowaną
 *       domeną adresu jest chronione, a konto ORG_ADMIN nie jest przejmowane przez rejestrację.
 * Przejęcie usuwa cudze zaproszenie (jego administrator widzi "wygasło" - bez informacji, kto przejął adres).
 *
 * Odczyt cudzego konta idzie przez istniejący wyjątek `runAuthLookup` (użytkownik po globalnym e-mailu; wynik służy WYŁĄCZNIE do tej
 * decyzji i nigdy nie jest zwracany klientowi); zapis (usunięcie) przez `runInOrgContext(organizacja właściciela)`, bez omijania RLS.
 */
@Injectable()
export class AddressClaimService {
  private readonly logger = new Logger(AddressClaimService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly organizationCleanup: PendingOrganizationCleanupService,
  ) {}

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
    if (owner.organizationId === organizationId || !this.isNeverActivated(owner)) return 'TAKEN';
    if (owner.role === 'ORG_ADMIN') {
      return (await this.takeOverPendingAdmin(owner, now)) ? 'CLAIMED' : 'TAKEN';
    }
    return (await this.expire(owner, now)) ? 'CLAIMED' : 'TAKEN';
  }

  /**
   * Czy rejestracja nowej organizacji na ten adres MOŻE przejąć istniejące konto (po potwierdzeniu skrzynki): nieaktywowane
   * zaproszenie pracownika w obcej organizacji, która nie ma zweryfikowanej domeny tego adresu. Tylko sprawdzenie, nic nie usuwa.
   */
  async isClaimableByRegistration(existing: User): Promise<boolean> {
    if (!this.isNeverActivated(existing) || existing.role === 'ORG_ADMIN') return false;
    return !(await this.hasVerifiedDomainOf(existing.organizationId, existing.email));
  }

  private isNeverActivated(user: User): boolean {
    return user.status === NEVER_ACTIVATED.status && user.emailVerifiedAt === null;
  }

  /**
   * Niepotwierdzony ORG_ADMIN organizacji PENDING (rejestracja na cudzy adres): przejmowany przez organizację ze zweryfikowaną domeną
   * adresu. Jedyny admin => cała organizacja PENDING znika od razu (warunek "nikt nie jest aktywowany" jest w samym DELETE);
   * są inni adminowie => usuwamy tylko to konto. Organizacja ACTIVE nigdy nie jest ruszana.
   */
  private async takeOverPendingAdmin(owner: User, now: Date): Promise<boolean> {
    try {
      const plan = await this.tenantPrisma.runInOrgContext(owner.organizationId, async (tx) => {
        // Blokada wiersza organizacji na czas transakcji (FOR SHARE): jej status nie zmieni się (weryfikacja domeny = UPDATE), zanim
        // usuniemy konto - warunek statusu i zapis są w tej samej, spójnej sekcji.
        const pending = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "organizations" WHERE "id" = ${owner.organizationId} AND "status" = 'PENDING_DOMAIN_VERIFICATION' FOR SHARE`;
        if (pending.length === 0) return 'NOT_PENDING' as const;
        const otherAdmins = await tx.user.count({ where: { organizationId: owner.organizationId, role: 'ORG_ADMIN', id: { not: owner.id } } });
        if (otherAdmins === 0) return 'SOLE_ADMIN' as const;
        return (await expireInvitedAccounts(tx, owner.organizationId, [owner.id], now)) === 1 ? ('EXPIRED' as const) : ('NOT_PENDING' as const);
      });
      if (plan === 'EXPIRED') return true;
      if (plan === 'SOLE_ADMIN') return await this.organizationCleanup.deleteNow(owner.organizationId);
      return false;
    } catch (error) {
      if (error instanceof InvitedAccountChangedError) return false;
      this.logger.error(`Przejęcie adresu nie powiodło się: ${(error as Error).name}`);
      return false;
    }
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

@Module({ imports: [OrganizationsModule], providers: [AddressClaimService], exports: [AddressClaimService] })
export class AddressClaimModule {}
