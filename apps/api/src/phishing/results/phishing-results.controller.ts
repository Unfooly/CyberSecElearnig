import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@cyberszkolo/shared';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SafeIdPipe } from '../../common/pipes/safe-id.pipe';
import { PeopleQueryDto, SetPersonalResultsDto } from '../dto/results.dto';
import { PhishingResultsService } from './phishing-results.service';

// Bez @AllowPendingOrganization - organizacja niezweryfikowana dostaje 403. organizationId i rola zawsze z JWT.
//
// Zakresy (egzekwuje TAKŻE serwis, kontroler to pierwsza linia):
//  - agregaty per dział: ORG_ADMIN (cała organizacja) i DEPARTMENT_MANAGER (wyłącznie własny dział),
//  - wyniki osobowe, ustawienia i audyt: wyłącznie ORG_ADMIN; wyniki osobowe dodatkowo wymagają włączonej flagi (403 bez niej).
@Controller('phishing/results')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhishingResultsController {
  constructor(private readonly results: PhishingResultsService) {}

  @Get('overview')
  @Roles(Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.results.overview(user);
  }

  @Get('campaigns/:id/departments')
  @Roles(Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER)
  departments(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.results.campaignDepartments(user, id);
  }

  // Nagłówki CSV ustawiamy DOPIERO po udanym wygenerowaniu pliku (nie dekoratorami @Header): dekorator działałby też na
  // odpowiedzi błędu i 403/404 w JSON-ie byłoby serwowane jako pobieralny plik .csv.
  @Get('campaigns/:id/departments.csv')
  @Roles(Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER)
  async departmentsCsv(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Res({ passthrough: true }) response: Response) {
    const csv = this.results.departmentsCsv(await this.results.campaignDepartments(user, id));
    return this.csv(response, 'wyniki-dzialy.csv', csv);
  }

  // Wyniki OSOBOWE: tylko ORG_ADMIN + włączona flaga (403 PERSONAL_RESULTS_DISABLED); każdy wgląd zapisuje audyt.
  @Get('campaigns/:id/people')
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // każdy wgląd zostawia wpis w dzienniku - bez zalewania go
  @Header('Cache-Control', 'no-store')
  people(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Query() query: PeopleQueryDto) {
    return this.results.people(user, id, query.filter);
  }

  @Get('campaigns/:id/people.csv')
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async peopleCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', SafeIdPipe) id: string,
    @Query() query: PeopleQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.csv(response, 'wyniki-osobowe.csv', await this.results.peopleCsv(user, id, query.filter));
  }

  private csv(response: Response, filename: string, content: string): string {
    response.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return content;
  }

  @Get('settings')
  @Roles(Role.ORG_ADMIN)
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.results.getSettings(user.organizationId);
  }

  @Post('settings/personal-results')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setPersonalResults(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPersonalResultsDto) {
    return this.results.setPersonalResults(user, dto);
  }

  @Get('settings/audit')
  @Roles(Role.ORG_ADMIN)
  audit(@CurrentUser() user: AuthenticatedUser) {
    return this.results.audit(user.organizationId);
  }
}
