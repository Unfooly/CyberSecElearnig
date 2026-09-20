import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProxyAwareThrottlerGuard } from './common/guards/proxy-aware-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CoursesModule } from './courses/courses.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EmailModule } from './email/email.module';
import { GamificationModule } from './gamification/gamification.module';
import { DemoRequestsModule } from './demo-requests/demo-requests.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PhishingModule } from './phishing/phishing.module';
import { ThreatReportsModule } from './threat-reports/threat-reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Domyślny globalny limit (drugi, ciaśniejszy limit jest dodatkowo
    // nałożony na /auth/login i /auth/register, patrz auth.controller.ts).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }]),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    DashboardModule,
    EmailModule,
    GamificationModule,
    DemoRequestsModule,
    OrganizationsModule,
    PhishingModule,
    ThreatReportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard }],
})
export class AppModule {}
