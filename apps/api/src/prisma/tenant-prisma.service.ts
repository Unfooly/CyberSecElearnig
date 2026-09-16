import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
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
   * WYJĄTEK od Zasady nr 1 — używać WYŁĄCZNIE w AuthService.login / .refresh,
   * gdzie użytkownika trzeba znaleźć po globalnie unikalnym e-mailu / id,
   * zanim jego organizationId jest znane. RLS jest fail-closed (brak
   * kontekstu = zero wierszy), więc ta metoda jawnie ustawia sentinel
   * app.bypass_tenant_rls, żeby ten jeden, ręcznie zweryfikowany lookup
   * mógł się wykonać.
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
}
