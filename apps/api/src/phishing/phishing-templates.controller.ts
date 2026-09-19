import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SafeIdPipe } from '../common/pipes/safe-id.pipe';
import { CloneTemplateDto, PreviewTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { PhishingTemplatesService } from './phishing-templates.service';

// Moduł symulacji phishingowych: wyłącznie ORG_ADMIN (EMPLOYEE i DEPARTMENT_MANAGER dostają 403).
// organizationId zawsze z JWT - nigdy z żądania.
@Controller('phishing/templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN)
export class PhishingTemplatesController {
  constructor(private readonly templates: PhishingTemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(user.organizationId);
  }

  // Podgląd sanityzacji treści (co zostanie po zapisie); nic nie zapisuje.
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewTemplateDto) {
    return this.templates.preview(dto);
  }

  // Historia zmian szablonów organizacji (kto, kiedy, jakie pola).
  @Get('edits')
  edits(@CurrentUser() user: AuthenticatedUser, @Query('templateId', new SafeIdPipe({ optional: true })) templateId?: string) {
    return this.templates.listEdits(user.organizationId, templateId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    return this.templates.get(user.organizationId, id);
  }

  @Post(':id/clone')
  clone(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Body() dto: CloneTemplateDto) {
    return this.templates.clone(user.organizationId, user, id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(user.organizationId, user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', SafeIdPipe) id: string) {
    await this.templates.remove(user.organizationId, user, id);
  }
}
