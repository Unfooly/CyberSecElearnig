import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    // Runtime backendu łączy się rolą cyberszkolo_app (DATABASE_URL_APP),
    // NIE rolą migracyjną z DATABASE_URL — tamta jest superuserem/
    // właścicielem tabel i zawsze omija RLS. Zasada nr 1 (CLAUDE.md) działa
    // tylko wtedy, gdy runtime łączy się mniej uprzywilejowaną rolą. Patrz
    // README "Dwie role Postgresa: migracje vs runtime".
    const appDatabaseUrl = configService.get<string>('DATABASE_URL_APP');
    if (!appDatabaseUrl) {
      throw new Error('Brak DATABASE_URL_APP w konfiguracji środowiska');
    }
    super({ datasources: { db: { url: appDatabaseUrl } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
