import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AllowPendingOrganization } from '../common/decorators/allow-pending-organization.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeIdPipe } from '../common/pipes/safe-id.pipe';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { GamificationService } from '../gamification/gamification.service';
import { MAX_AVATAR_UPLOAD_BYTES } from './avatar-image';
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

  // Bez @Roles() - dowolna zalogowana rola może zmienić WŁASNY avatar (wyłącznie na preset; plik idzie niżej).
  @Patch('me/avatar')
  @AllowPendingOrganization()
  updateMyAvatar(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAvatarDto) {
    return this.usersService.updateAvatar(user.organizationId, user.userId, dto.avatarUrl);
  }

  // Własny avatar z pliku (D-067). Limit rozmiaru egzekwuje Multer PRZED wczytaniem treści; żadnych pól tekstowych
  // (`fields: 0`) i najwyżej 2 części multipart - inaczej zalogowany użytkownik mógłby wysłać tysiące pól i zjeść pamięć.
  // Throttle, bo każde żądanie to dekodowanie i przeskalowanie obrazu (koszt CPU).
  @Post('me/avatar/image')
  @HttpCode(HttpStatus.OK)
  @AllowPendingOrganization()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES, files: 1, fields: 0, parts: 2 } }))
  uploadMyAvatarImage(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    return this.usersService.uploadAvatarImage(user.organizationId, user.userId, file);
  }

  @Delete('me/avatar/image')
  @AllowPendingOrganization()
  deleteMyAvatarImage(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deleteAvatarImage(user.organizationId, user.userId);
  }

  // Obrazek avatara użytkownika Z TEJ SAMEJ organizacji (ranking, tabele) - organizationId wyłącznie z tokena
  // wywołującego, więc nie da się pobrać avatara z obcej organizacji (test izolacji A/B). Trasa MUSI stać po
  // 'me/avatar/image', żeby "me" nie zostało potraktowane jako identyfikator użytkownika.
  @Get(':id/avatar/image')
  @AllowPendingOrganization()
  @Header('Cache-Control', 'private, max-age=300')
  async getUserAvatarImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', SafeIdPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.usersService.getAvatarImage(user.organizationId, id);
    if (!image) {
      // Ten sam wynik dla "nie ma avatara" i "nie ma takiego użytkownika w mojej organizacji" - brak wyroczni.
      throw new NotFoundException('Avatar nie istnieje.');
    }
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('ETag', `"${image.hash}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(image.bytes);
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

  // Bez @Roles() - dowolna zalogowana rola czyta WŁASNE imię i inicjał nazwiska (legitymacja w odprawie odtwarzacza, D-081).
  // Bez parametru userId: tylko własne dane. Bez @AllowPendingOrganization(): używa tego wyłącznie odtwarzacz kursów, a kursy
  // są niedostępne dla organizacji czekającej na weryfikację domeny (guard PENDING, fail-closed).
  @Get('me/display-name')
  getMyDisplayName(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getDisplayName(user.organizationId, user.userId);
  }

  // Bez @Roles() - dowolna zalogowana rola widzi WŁASNY postęp grywalizacji.
  @Get('me/gamification')
  getMyGamification(@CurrentUser() user: AuthenticatedUser) {
    return this.gamificationService.getMyGamificationSummary(user.organizationId, user.userId);
  }
}
