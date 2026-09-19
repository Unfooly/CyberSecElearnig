import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActiveOrganizationGuard } from '../common/guards/active-organization.guard';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../email/email.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RegistrationService } from './registration.service';
import { RegistrationMailLimiter } from './registration-mail-limiter';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({}), EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    RegistrationService,
    RegistrationMailLimiter,
    JwtStrategy,
    // Globalny, fail-closed guard organizacji PENDING (patrz komentarz w guardzie).
    { provide: APP_GUARD, useClass: ActiveOrganizationGuard },
  ],
  // UsersModule (inviteUser/importCsv) reużywa issuePasswordResetUrl -
  // ten sam wzorzec co GamificationModule -> UsersModule.
  exports: [AuthService],
})
export class AuthModule {}
