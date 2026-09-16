import { Injectable } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * organizationId pochodzi WYŁĄCZNIE z tokena JWT wywołującego (zob.
   * UsersController) — endpoint świadomie nie przyjmuje organizationId od
   * klienta, żeby wykluczyć klasę błędów typu "zapomniany filtr".
   */
  async findAllForOrg(organizationId: string): Promise<UserResponseDto[]> {
    const users = await this.tenantPrisma.runInOrgContext(organizationId, (tx) =>
      tx.user.findMany({
        where: { organizationId },
        select: {
          id: true,
          email: true,
          role: true,
          departmentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );

    // Prisma generuje własny typ enum Role ze schema.prisma, strukturalnie
    // identyczny z @cyberszkolo/shared Role, ale nominalnie odrębny — stąd
    // jawne rzutowanie zamiast duplikowania wartości enuma.
    return users.map((user) => ({ ...user, role: user.role as Role }));
  }
}
