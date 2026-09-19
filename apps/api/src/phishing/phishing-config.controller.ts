import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PhishingConfigService } from './phishing-config.service';

// Status konfiguracji modułu (transport, domena nadawcy, host strony lądowania) - tylko ORG_ADMIN.
// Bez sekretów: tokeny i adresy dostępowe nigdy nie opuszczają konfiguracji serwera.
@Controller('phishing/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN)
export class PhishingConfigController {
  constructor(private readonly config: PhishingConfigService) {}

  @Get()
  get() {
    return this.config.status();
  }
}
