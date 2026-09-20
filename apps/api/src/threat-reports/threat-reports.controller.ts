import { Body, Controller, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateThreatReportDto } from './dto/create-threat-report.dto';
import { ThreatReportsService } from './threat-reports.service';

// Bez @AllowPendingOrganization - organizacja niezweryfikowana dostaje 403 (przed weryfikacją domeny nie ma symulacji,
// a zgłoszenia trafiłyby do organizacji, która jeszcze nie jest aktywna). organizationId, id i rola zawsze z JWT.
@Controller('threat-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ThreatReportsController {
  constructor(private readonly reports: ThreatReportsService) {}

  // Zgłaszać może każdy zalogowany użytkownik organizacji (pracownik, kierownik, admin). Limity per użytkownik (5/h,
  // 20/dobę) egzekwuje serwis w bazie; @Throttle to dodatkowa osłona przed zalewaniem endpointu z jednego adresu.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.EMPLOYEE, Role.DEPARTMENT_MANAGER, Role.ORG_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateThreatReportDto) {
    return this.reports.submit(user, dto);
  }
}
