import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SafeIdPipe } from '../common/pipes/safe-id.pipe';
import { AddNoteDto, ChangeStatusDto, InboxQueryDto } from './dto/inbox.dto';
import { ThreatReportInboxService } from './threat-report-inbox.service';

// Skrzynka zgłoszeń. Bez @AllowPendingOrganization - organizacja niezweryfikowana dostaje 403. organizationId i rola z JWT,
// ale rolę, status i dział ponownie czyta z bazy serwis (kontroler to pierwsza linia):
//  - ORG_ADMIN: lista, szczegóły (treść, zgłaszający), zmiana statusu i notatki (z dziennikiem zdarzeń),
//  - DEPARTMENT_MANAGER: wyłącznie ograniczona lista własnego działu (bez zgłaszającego, treści i notatek; bez zmian).
@Controller('threat-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ThreatReportInboxController {
  constructor(private readonly inbox: ThreatReportInboxService) {}

  @Get('inbox')
  @Roles(Role.ORG_ADMIN)
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: InboxQueryDto) {
    return this.inbox.listForAdmin(user, query);
  }

  // Każdy wgląd jest audytowany (wpis w dzienniku wglądów) - limit chroni dziennik przed zalaniem odświeżaniem.
  @Get('inbox/:id')
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.inbox.getForAdmin(user, id);
  }

  @Post('inbox/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  changeStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.inbox.changeStatus(user, id, dto);
  }

  @Post('inbox/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  addNote(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Body() dto: AddNoteDto) {
    return this.inbox.addNote(user, id, dto);
  }

  @Get('department')
  @Roles(Role.DEPARTMENT_MANAGER)
  @Header('Cache-Control', 'no-store')
  department(@CurrentUser() user: AuthenticatedUser, @Query() query: InboxQueryDto) {
    return this.inbox.listForManager(user, query);
  }
}
