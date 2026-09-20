import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { PhishingModule } from '../phishing/phishing.module';
import { ThreatReportInboxController } from './threat-report-inbox.controller';
import { ThreatReportInboxService } from './threat-report-inbox.service';
import { ThreatReportNotificationService } from './threat-report-notification.service';
import { ThreatReportRetentionService } from './threat-report-retention.service';
import { ThreatReportsController } from './threat-reports.controller';
import { ThreatReportsService } from './threat-reports.service';

// Zgłaszanie podejrzanych wiadomości przez pracowników + skrzynka zgłoszeń + powiadomienia. Maile idą przez EmailService
// (transakcyjny); ten moduł NIE używa transportu symulacji phishingowych.
@Module({
  imports: [JobsModule, PhishingModule, EmailModule],
  controllers: [ThreatReportsController, ThreatReportInboxController],
  providers: [ThreatReportsService, ThreatReportInboxService, ThreatReportNotificationService, ThreatReportRetentionService],
})
export class ThreatReportsModule {}
