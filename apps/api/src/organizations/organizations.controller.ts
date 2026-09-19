import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AllowPendingOrganization } from '../common/decorators/allow-pending-organization.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DomainVerificationService } from './domain-verification.service';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { OrganizationsService } from './organizations.service';

// Ekran weryfikacji domeny i ustawienia: JEDYNE trasy dostępne dla organizacji
// w stanie PENDING_DOMAIN_VERIFICATION (patrz ActiveOrganizationGuard).
@Controller('organization')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN)
@AllowPendingOrganization()
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly domainVerification: DomainVerificationService,
  ) {}

  @Get('me')
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getOverview(user.organizationId);
  }

  // "Sprawdź teraz": zapytanie DNS - ciasny limit na IP (poza cooldownem per organizacja).
  @Post('domain/check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  checkDomain(@CurrentUser() user: AuthenticatedUser) {
    return this.domainVerification.check(user.organizationId);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOrganizationSettingsDto) {
    return this.organizationsService.updateSettings(user.organizationId, dto);
  }
}
