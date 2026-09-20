import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { InviteNoticeMailLimiter } from '../auth/registration-mail-limiter';
import { AddressClaimModule } from './address-claim.service';
import { InviteExpiryService } from './invite-expiry.service';
import { UserImportController } from './import/user-import.controller';
import { UserImportInviteService } from './import/user-import-invite.service';
import { UserImportRetentionService } from './import/user-import-retention.service';
import { UserImportService } from './import/user-import.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  // AuthModule - UsersService reużywa AuthService.issuePasswordResetUrl dla
  // zaproszeń (ten sam wzorzec eksportu co GamificationModule tutaj).
  // EmailModule - wysyłka e-maila z zaproszeniem.
  // JobsModule - sprzątanie wygasłych podglądów importu (zadanie cykliczne).
  // AddressClaimModule - pierwszeństwo do adresu (przejęcie nieaktywowanego zaproszenia przez organizację ze zweryfikowaną domeną).
  imports: [GamificationModule, AuthModule, EmailModule, JobsModule, AddressClaimModule],
  controllers: [UsersController, UserImportController],
  // InviteNoticeMailLimiter: wiadomość "ktoś próbował dodać Cię" ma limit "jedna na skrzynkę na 10 minut" jak maile rejestracyjne,
  // ale w osobnej przestrzeni kluczy (nie zjada okna maila rejestracyjnego/aktywacyjnego właściciela).
  providers: [UsersService, UserImportService, UserImportRetentionService, UserImportInviteService, InviteExpiryService, InviteNoticeMailLimiter],
})
export class UsersModule {}
