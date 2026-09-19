import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhishingConfigController } from './phishing-config.controller';
import { PhishingConfigService } from './phishing-config.service';
import { PhishingTemplatesController } from './phishing-templates.controller';
import { PhishingTemplatesService } from './phishing-templates.service';
import { PhishingMailTransport } from './transport/phishing-mail-transport';
import { createPhishingTransport } from './transport/transport-config';

// Symulacje phishingowe. Kolejne etapy modułu (kampanie, śledzenie, wyniki) dochodzą tu.
// UWAGA: moduł NIE importuje EmailModule - maile symulacji idą wyłącznie przez PhishingMailTransport
// (osobny transport, osobne tokeny), a maile transakcyjne wyłącznie przez EmailService.
@Module({
  controllers: [PhishingTemplatesController, PhishingConfigController],
  providers: [
    PhishingTemplatesService,
    PhishingConfigService,
    // Wymienny transport wybierany przez env (PHISHING_MAIL_TRANSPORT): mailersend | smtp | log.
    { provide: PhishingMailTransport, useFactory: (config: ConfigService) => createPhishingTransport(config), inject: [ConfigService] },
  ],
  exports: [PhishingTemplatesService, PhishingConfigService, PhishingMailTransport],
})
export class PhishingModule {}
