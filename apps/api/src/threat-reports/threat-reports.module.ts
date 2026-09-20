import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { PhishingModule } from '../phishing/phishing.module';
import { ThreatReportRetentionService } from './threat-report-retention.service';
import { ThreatReportsController } from './threat-reports.controller';
import { ThreatReportsService } from './threat-reports.service';

// Zgłaszanie podejrzanych wiadomości przez pracowników. Kolejne etapy (wyniki, panel admina, powiadomienia) dochodzą tu.
@Module({
  imports: [JobsModule, PhishingModule],
  controllers: [ThreatReportsController],
  providers: [ThreatReportsService, ThreatReportRetentionService],
})
export class ThreatReportsModule {}
