import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsModule } from '../jobs/jobs.module';
import { CampaignReconcileService } from './campaigns/campaign-reconcile.service';
import { CampaignSenderService } from './campaigns/campaign-sender.service';
import { PhishingCampaignsController } from './campaigns/phishing-campaigns.controller';
import { PhishingCampaignsService } from './campaigns/phishing-campaigns.service';
import { BullPhishingSendQueue, PhishingSendQueue } from './campaigns/phishing-send-queue';
import { PhishingConfigController } from './phishing-config.controller';
import { PhishingConfigService } from './phishing-config.service';
import { PhishingTemplatesController } from './phishing-templates.controller';
import { PhishingTemplatesService } from './phishing-templates.service';
import { PhishingMailTransport } from './transport/phishing-mail-transport';
import { createPhishingTransport } from './transport/transport-config';

// Symulacje phishingowe. Kolejne etapy modułu (śledzenie, wyniki) dochodzą tu.
// UWAGA: moduł NIE importuje EmailModule - maile symulacji idą wyłącznie przez PhishingMailTransport
// (osobny transport, osobne tokeny), a maile transakcyjne wyłącznie przez EmailService.
@Module({
  imports: [JobsModule],
  controllers: [PhishingTemplatesController, PhishingConfigController, PhishingCampaignsController],
  providers: [
    PhishingTemplatesService,
    PhishingConfigService,
    PhishingCampaignsService,
    CampaignSenderService,
    CampaignReconcileService,
    // Kolejka wysyłki za portem: BullMQ w aplikacji, atrapa w testach (bez czekania na realne opóźnienia).
    { provide: PhishingSendQueue, useClass: BullPhishingSendQueue },
    // Wymienny transport wybierany przez env (PHISHING_MAIL_TRANSPORT): mailersend | smtp | log.
    { provide: PhishingMailTransport, useFactory: (config: ConfigService) => createPhishingTransport(config), inject: [ConfigService] },
  ],
  exports: [PhishingTemplatesService, PhishingConfigService, PhishingMailTransport],
})
export class PhishingModule {}
