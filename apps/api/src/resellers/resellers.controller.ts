import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SafeIdPipe } from '../common/pipes/safe-id.pipe';
import { AssignOrganizationDto } from './dto/assign-organization.dto';
import { CreateResellerDto } from './dto/create-reseller.dto';
import { ResellersService } from './resellers.service';

/**
 * Panel OPERATORA (D-070): zakładanie partnerów i przypisywanie im organizacji klienckich.
 * Wyłącznie SUPER_ADMIN - klient nie może przypiąć ani odpiąć swojego resellera (decyzja
 * właściciela produktu 2026-09-22), więc nie ma odpowiednika tych tras dla ORG_ADMIN-a.
 */
@Controller('resellers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class ResellersController {
  constructor(private readonly resellers: ResellersService) {}

  @Get()
  list() {
    return this.resellers.listResellers();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateResellerDto) {
    return this.resellers.createReseller(dto, user.email);
  }

  // Lista organizacji klienckich z informacją, kto je dziś obsługuje - do wyboru w panelu.
  @Get('assignable-organizations')
  assignable() {
    return this.resellers.listAssignableOrganizations();
  }

  @Post(':id/organizations')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', SafeIdPipe) id: string,
    @Body() dto: AssignOrganizationDto,
  ): Promise<void> {
    await this.resellers.assignOrganization(id, dto.organizationId, user.email);
  }

  @Delete(':id/organizations/:organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(
    @Param('id', SafeIdPipe) id: string,
    @Param('organizationId', SafeIdPipe) organizationId: string,
  ): Promise<void> {
    await this.resellers.unassignOrganization(id, organizationId);
  }
}

/**
 * Panel PARTNERA (D-070): lista własnych klientów. `organizationId` bierze się wyłącznie z tokena,
 * więc partner nie zobaczy cudzej listy. Krok 1 nie daje dostępu do danych klienta - tylko metadane
 * organizacji; „wejdź jako organizacja” (token zakresowany + audyt) to osobne zadanie.
 */
@Controller('reseller')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.RESELLER_ADMIN)
export class ResellerPortalController {
  constructor(private readonly resellers: ResellersService) {}

  @Get('clients')
  clients(@CurrentUser() user: AuthenticatedUser) {
    return this.resellers.listClients(user.organizationId);
  }
}
