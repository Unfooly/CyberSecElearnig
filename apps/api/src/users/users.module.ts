import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  // AuthModule - UsersService reużywa AuthService.issuePasswordResetUrl dla
  // zaproszeń (ten sam wzorzec eksportu co GamificationModule tutaj).
  // EmailModule - wysyłka e-maila z zaproszeniem.
  imports: [GamificationModule, AuthModule, EmailModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
