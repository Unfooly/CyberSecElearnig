import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { UserImportController } from './import/user-import.controller';
import { UserImportRetentionService } from './import/user-import-retention.service';
import { UserImportService } from './import/user-import.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  // AuthModule - UsersService reużywa AuthService.issuePasswordResetUrl dla
  // zaproszeń (ten sam wzorzec eksportu co GamificationModule tutaj).
  // EmailModule - wysyłka e-maila z zaproszeniem.
  // JobsModule - sprzątanie wygasłych podglądów importu (zadanie cykliczne).
  imports: [GamificationModule, AuthModule, EmailModule, JobsModule],
  controllers: [UsersController, UserImportController],
  providers: [UsersService, UserImportService, UserImportRetentionService],
})
export class UsersModule {}
