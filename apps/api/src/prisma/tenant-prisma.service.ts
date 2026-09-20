import { Injectable } from '@nestjs/common';
import { EmailVerificationToken, Prisma, PasswordResetToken, RefreshToken, User } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Wszystkie zapytania dotykające danych klienckich MUSZĄ przechodzić przez
 * runInOrgContext, żeby zarówno filtr w kodzie (where: organizationId), jak
 * i RLS w Postgresie (policy na app.current_org_id) chroniły izolację
 * tenantów — patrz CLAUDE.md "Zasada nr 1".
 */
/** Wynik runTrackingTokenLookup: tylko identyfikatory i znaczniki czasu (bez danych osobowych). */
export interface TrackingRecipientRef {
  id: string;
  organizationId: string;
  campaignId: string;
  userId: string | null;
  claimedAt: Date | null;
}

@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  async runInOrgContext<T>(
    organizationId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
      return fn(tx);
    });
  }

  /**
   * WYJĄTEK od Zasady nr 1 — używać WYŁĄCZNIE w AuthService.login / .refresh
   * / .forgotPassword / .resendVerification oraz RegistrationService.register
   * (tylko do sprawdzenia, czy adres ma już konto; wynik nie trafia do
   * odpowiedzi), gdzie użytkownika trzeba znaleźć po globalnie
   * unikalnym e-mailu / id, zanim jego organizationId jest znane. RLS jest
   * fail-closed (brak kontekstu = zero wierszy), więc ta metoda jawnie
   * ustawia sentinel app.bypass_tenant_rls, żeby ten jeden, ręcznie
   * zweryfikowany lookup mógł się wykonać.
   *
   * Celowo przyjmuje tylko `UserWhereUniqueInput` i zawsze robi `findUnique`
   * (zamiast dowolnej funkcji) — to jest furtka omijająca RLS, więc typy, a
   * nie tylko konwencja, mają wykluczać użycie jej do zapytań zwracających
   * więcej niż jeden rekord.
   */
  async runAuthLookup(where: Prisma.UserWhereUniqueInput): Promise<User | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return tx.user.findUnique({ where });
    });
  }

  /**
   * DRUGI wąski wyjątek od Zasady nr 1, ten sam sentinel co runAuthLookup —
   * używać WYŁĄCZNIE w AuthService.resetPassword, gdzie token trzeba
   * odnaleźć po globalnie unikalnym tokenHash, zanim organizationId jest
   * znane (patrz migracja enable_rls_password_reset_tokens — bypass
   * obejmuje tam tylko USING, nie WITH CHECK, więc tej metody i tak nie da
   * się użyć do zapisu w cudzej organizacji nawet przez pomyłkę).
   *
   * Jak runAuthLookup: sztywny `findUnique` po jednym polu, nie dowolna
   * funkcja — typy wykluczają użycie tej furtki do zapytań zwracających
   * więcej niż jeden rekord.
   */
  async runPasswordResetTokenLookup(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return tx.passwordResetToken.findUnique({ where: { tokenHash } });
    });
  }

  /**
   * TRZECI wąski wyjątek od Zasady nr 1, ten sam sentinel co
   * runPasswordResetTokenLookup - WYŁĄCZNIE dla AuthService.verifyEmail
   * (token odnajdywany po globalnie unikalnym tokenHash, zanim znamy
   * organizationId). Sztywny findUnique po jednym polu; bypass obejmuje
   * tylko USING (odczyt), nie WITH CHECK.
   */
  async runEmailVerificationTokenLookup(tokenHash: string): Promise<EmailVerificationToken | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return tx.emailVerificationToken.findUnique({ where: { tokenHash } });
    });
  }

  /**
   * CZWARTY wąski wyjątek od Zasady nr 1, ten sam sentinel co
   * runPasswordResetTokenLookup - WYŁĄCZNIE dla SessionsService (/auth/refresh i
   * /auth/logout): refresh token odnajdywany po globalnie unikalnym tokenHash
   * (SHA-256), zanim organizationId jest znane. Sztywny findUnique po jednym polu;
   * bypass obejmuje tylko USING (odczyt), więc pod nim nie da się zapisać wiersza w
   * cudzej organizacji. Wszystkie zapisy (rotacja, unieważnienie) idą już przez
   * runInOrgContext(record.organizationId).
   */
  async runRefreshTokenLookup(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return tx.refreshToken.findUnique({ where: { tokenHash } });
    });
  }

  /**
   * PIĄTY wąski wyjątek od Zasady nr 1 (lookup po hashu tokenu, jak runRefreshTokenLookup) - WYŁĄCZNIE dla
   * TrackingService (publiczne POST /t/:token/view|submit). Odwiedzający zna tylko token z linku w mailu; organizację
   * poznajemy dopiero z wiersza odbiorcy. Sztywny `findUnique` po jednym polu (SHA-256 tokenu, unikalny indeks) i
   * WĄSKI select (identyfikatory i znaczniki czasu, bez adresu e-mail i bez treści) - typy, nie konwencja, wykluczają
   * użycie tej furtki do zapytań zwracających więcej rekordów lub więcej danych. Bypass ma WŁASNY sentinel
   * (app.bypass_tracking_lookup) i obejmuje tylko politykę SELECT phishing_campaign_recipients (migracje
   * phishing_tracking i phishing_tracking_lookup_sentinel): pod nim nie da się niczego zapisać ani usunąć, a
   * runCrossOrgQuery (inny sentinel) odbiorców kampanii nie widzi. Wszystkie zapisy (kliknięcie, formularz, przypisanie kursu) idą już przez runInOrgContext(organizationId
   * odczytanego wiersza). Brak wiersza = null (wołający zwraca odpowiedź neutralną, identyczną jak dla poprawnego tokenu).
   */
  async runTrackingTokenLookup(tokenHash: string): Promise<TrackingRecipientRef | null> {
    return this.prisma.$transaction(async (tx) => {
      // OSOBNY sentinel (nie app.bypass_tenant_rls): polityka SELECT odbiorców honoruje tylko ten, więc generyczny
      // runCrossOrgQuery nie zyskuje dostępu do wyników kampanii.
      await tx.$executeRaw`SELECT set_config('app.bypass_tracking_lookup', 'on', true)`;
      return tx.phishingCampaignRecipient.findUnique({
        where: { tokenHash },
        select: { id: true, organizationId: true, campaignId: true, userId: true, claimedAt: true },
      });
    });
  }

  /**
   * SZÓSTY wąski wyjątek od Zasady nr 1, ten sam sentinel co runCrossOrgQuery - WYŁĄCZNIE dla
   * CampaignReconcileService (zadanie uzgadniające kampanie symulacji). Zwraca TYLKO pary (id, organizationId)
   * kampanii do uzgodnienia: aktywnych (SCHEDULED/RUNNING) oraz anulowanych w ciągu ostatnich `cancelledSince`.
   * Typ wyniku (select) nie ujawnia treści kampanii ani adresów; strona po id (kursor) - bez głodzenia nowszych.
   * Polityka SELECT phishing_campaigns dopuszcza bypass tylko do odczytu (INSERT/UPDATE/DELETE nie), a odbiorcy
   * kampanii są pod bypassem niewidoczni. Cała dalsza praca idzie w runInOrgContext(organizationId kampanii).
   */
  async listCampaignsToReconcile(cancelledSince: Date, afterId: string | null, take: number): Promise<{ id: string; organizationId: string }[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return tx.phishingCampaign.findMany({
        where: {
          OR: [{ status: { in: ['SCHEDULED', 'RUNNING'] } }, { status: 'CANCELLED', cancelledAt: { gte: cancelledSince } }],
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true, organizationId: true },
        orderBy: { id: 'asc' },
        take,
      });
    });
  }

  /**
   * DRUGI wyjątek od Zasady nr 1 — używać WYŁĄCZNIE w DashboardService dla
   * GET /dashboard/admin/organizations (SUPER_ADMIN, panel operacyjny), w jobie
   * RefreshTokenCleanupService (usuwanie WYGASŁYCH refresh tokenów wszystkich
   * organizacji). Uwaga: DELETE sprawdza tylko USING, więc pod bypassem jest dozwolony wobec
   * DOWOLNYCH wierszy - ochroną jest wyłącznie jawny warunek `where` (data wygaśnięcia) w
   * wołającym; INSERT/UPDATE pod bypassem blokuje WITH CHECK.
   * To jedyny endpoint w projekcie, który świadomie czyta dane wielu
   * organizacji naraz — kontroler musi sprawdzić rolę SUPER_ADMIN przez
   * RolesGuard PRZED wywołaniem tej metody, nie polegać na niej samej jako
   * na kontroli dostępu.
   *
   * Ten sam sentinel app.bypass_tenant_rls co runAuthLookup, ale na
   * course_assignments obejmuje tylko klauzulę USING (odczyt) — WITH CHECK
   * (zapis) nadal wymaga zgodności organizationId, więc tej metody nie da
   * się użyć do zapisu danych w cudzej organizacji nawet przez pomyłkę.
   */
  async runCrossOrgQuery<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'on', true)`;
      return fn(tx);
    });
  }
}
