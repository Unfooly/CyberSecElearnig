import { Module } from '@nestjs/common';
import { PhishingTemplatesController } from './phishing-templates.controller';
import { PhishingTemplatesService } from './phishing-templates.service';

// Symulacje phishingowe. Kolejne etapy modułu (transport, kampanie, śledzenie, wyniki) dochodzą tu.
@Module({
  controllers: [PhishingTemplatesController],
  providers: [PhishingTemplatesService],
  exports: [PhishingTemplatesService],
})
export class PhishingModule {}
