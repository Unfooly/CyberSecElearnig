import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SafeIdPipe } from '../../common/pipes/safe-id.pipe';
import { AudiencePreviewDto, CreateCampaignDto } from '../dto/campaign.dto';
import { PhishingCampaignsService } from './phishing-campaigns.service';

// Kampanie: wyłącznie ORG_ADMIN. Bez @AllowPendingOrganization - organizacja niezweryfikowana dostaje 403
// (symulacje phishingowe wolno uruchamiać dopiero po potwierdzeniu własności domeny).
// organizationId zawsze z JWT - nigdy z żądania. Wyniki per osoba NIE są tu wystawiane (commit 5 z osobną ochroną).
@Controller('phishing/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN)
export class PhishingCampaignsController {
  constructor(private readonly campaigns: PhishingCampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.list(user.organizationId);
  }

  // Liczba odbiorców dla wybranego grona (krok kreatora); nic nie zapisuje.
  @Post('audience')
  @HttpCode(HttpStatus.OK)
  audience(@CurrentUser() user: AuthenticatedUser, @Body() dto: AudiencePreviewDto) {
    return this.campaigns.previewAudience(user.organizationId, dto.audience);
  }

  // Tworzenie kampanii to rzadka, kosztowna operacja (do 5000 wierszy i zadań): limit żądań na klienta.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.organizationId, user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.campaigns.get(user.organizationId, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.campaigns.cancel(user.organizationId, id);
  }
}
