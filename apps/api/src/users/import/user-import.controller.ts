import { Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SafeIdPipe } from '../../common/pipes/safe-id.pipe';
import { MAX_IMPORT_BYTES } from './csv-import';
import { ImportRowsQueryDto } from './dto/import-query.dto';
import { UserImportService } from './user-import.service';

// Import pracowników z CSV, krok 1 (podgląd). Tylko ORG_ADMIN (i organizacja ACTIVE - bez @AllowPendingOrganization).
// organizationId i rola z JWT, ale rolę i status ponownie czyta z bazy serwis. Krok potwierdzenia dochodzi w commicie 5/5.
@Controller('users/import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserImportController {
  constructor(private readonly imports: UserImportService) {}

  // Limit rozmiaru pliku (1 MB) egzekwuje Multer PRZED tym, jak treść trafi do parsera; limit wierszy (5000) parser.
  @Post('preview')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ORG_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  // Dodatkowo: żadnych pól tekstowych (`fields: 0`) i najwyżej 2 części multipart - bez tego zalogowany admin mógłby wysłać
  // tysiące pól i zjeść pamięć (domyślnie pola są nieograniczone).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0, parts: 2 } }))
  @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    return this.imports.preview(user, file);
  }

  @Get(':id')
  @Roles(Role.ORG_ADMIN)
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.imports.get(user, id);
  }

  @Get(':id/rows')
  @Roles(Role.ORG_ADMIN)
  @Header('Cache-Control', 'no-store')
  rows(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Query() query: ImportRowsQueryDto) {
    return this.imports.rows(user, id, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ORG_ADMIN)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.imports.cancel(user, id);
  }
}
