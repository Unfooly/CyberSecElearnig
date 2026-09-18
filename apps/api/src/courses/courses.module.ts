import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';

@Module({
  imports: [GamificationModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}
