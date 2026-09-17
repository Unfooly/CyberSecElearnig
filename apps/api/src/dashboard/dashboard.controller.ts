import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';
import { ExportQueryDto } from './dto/export-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(Role.ORG_ADMIN)
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getOverview(user.organizationId);
  }

  @Get('departments')
  @Roles(Role.ORG_ADMIN)
  getDepartmentBreakdown(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getDepartmentBreakdown(user.organizationId);
  }

  @Get('export')
  @Roles(Role.ORG_ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="raport-organizacja.csv"')
  // ExportQueryDto/ValidationPipe odrzuca (400) każdy format poza "csv" -
  // PDF to osobne zadanie, jeśli będzie potrzebne.
  exportReport(@CurrentUser() user: AuthenticatedUser, @Query() query: ExportQueryDto) {
    return this.dashboardService.exportCsv(user.organizationId, query.format ?? 'csv');
  }

  // Jedyny endpoint w projekcie, który świadomie NIE filtruje po
  // organizationId requestera - RolesGuard sprawdza SUPER_ADMIN przed
  // wywołaniem serwisu (patrz DashboardService.getOrganizationsOverview).
  @Get('admin/organizations')
  @Roles(Role.SUPER_ADMIN)
  getOrganizationsOverview() {
    return this.dashboardService.getOrganizationsOverview();
  }
}
