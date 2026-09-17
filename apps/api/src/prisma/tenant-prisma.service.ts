import { Injectable } from '@nestjs/common';
import { Prisma, PasswordResetToken, User } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Wszystkie zapytania dotykające danych klienckich MUSZĄ przechodzić przez
 * runInOrgContext, żeby zarówno filtr w kodzie (where: organizationId), jak
 * i RLS w Postgresie (policy na app.current_org_id) chroniły izolację
 * tenantów — patrz CLAUDE.md "Zasada nr 1".
 */
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
   * / .forgotPassword, gdzie użytkownika trzeba znaleźć po globalnie
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
   * DRUGI wyjątek od Zasady nr 1 — używać WYŁĄCZNIE w DashboardService dla
   * GET /dashboard/admin/organizations (SUPER_ADMIN, panel operacyjny).
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
