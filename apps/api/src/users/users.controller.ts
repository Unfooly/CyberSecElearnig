import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AllowPendingOrganization } from '../common/decorators/allow-pending-organization.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { GamificationService } from '../gamification/gamification.service';
import { UsersService } from './users.service';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// Import pracowników z CSV: UserImportController (users/import/*, dwuetapowy: podgląd i potwierdzenie).

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly gamificationService: GamificationService,
  ) {}

  // Tylko ORG_ADMIN - DEPARTMENT_MANAGER ma widzieć wyłącznie swój dział
  // (CLAUDE.md), a scoping po dziale nie jest jeszcze zaimplementowany;
  // otwarcie tej listy dla managera pokazywałoby mu całą organizację.
  @Get()
  @Roles(Role.ORG_ADMIN)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.findPaginated(user.organizationId, query);
  }

  @Get('departments')
  @Roles(Role.ORG_ADMIN)
  listDepartments(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listDepartments(user.organizationId);
  }

  // Twardszy limit niż globalny (20/min) - każde zaproszenie wysyła e-mail z
  // domeny platformy do dowolnego adresu.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invite')
  @Roles(Role.ORG_ADMIN)
  invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return this.usersService.inviteUser(user.organizationId, dto, user.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/resend-invite')
  @Roles(Role.ORG_ADMIN)
  @HttpCode(200)
  resendInvite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.resendInvite(user.organizationId, id, user.email);
  }

  @Patch(':id')
  @Roles(Role.ORG_ADMIN)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(user.organizationId, user.userId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ORG_ADMIN)
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.deleteUser(user.organizationId, user.userId, id);
  }

  // Bez @Roles() - dowolna zalogowana rola widzi WŁASNY avatar (Topbar).
  // Dostępne też przy organizacji czekającej na weryfikację domeny (dane własnego profilu).
  @Get('me/avatar')
  @AllowPendingOrganization()
  getMyAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getAvatar(user.organizationId, user.userId);
  }

  // Bez @Roles() - dowolna zalogowana rola może zmienić WŁASNY avatar.
  @Patch('me/avatar')
  @AllowPendingOrganization()
  updateMyAvatar(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAvatarDto) {
    return this.usersService.updateAvatar(user.organizationId, user.userId, dto.avatarUrl);
  }

  // Bez @Roles() - dowolna zalogowana rola czyta i zmienia WŁASNE preferencje (lektor w odtwarzaczu szkoleń). Bez
  // @AllowPendingOrganization(): kursy są niedostępne dla organizacji czekającej na weryfikację domeny, więc preferencje
  // odtwarzacza też (domyślnie zablokowane, guard PENDING).
  @Get('me/preferences')
  getMyPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getPreferences(user.organizationId, user.userId);
  }

  @Patch('me/preferences')
  updateMyPreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return this.usersService.updatePreferences(user.organizationId, user.userId, dto);
  }

  // Bez @Roles() - dowolna zalogowana rola widzi WŁASNY postęp grywalizacji.
  @Get('me/gamification')
  getMyGamification(@CurrentUser() user: AuthenticatedUser) {
    return this.gamificationService.getMyGamificationSummary(user.organizationId, user.userId);
  }
}
