import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';

@Module({
  controllers: [GamificationController],
  providers: [GamificationService],
  // Eksportowane - CoursesModule (przyznawanie XP przy ukończeniu kursu) i
  // UsersModule (GET /users/me/gamification) wstrzykują ten serwis.
  exports: [GamificationService],
})
export class GamificationModule {}
