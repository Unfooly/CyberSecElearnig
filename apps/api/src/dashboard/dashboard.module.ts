import { Module } from '@nestjs/common';
import { PhishingModule } from '../phishing/phishing.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PhishingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
