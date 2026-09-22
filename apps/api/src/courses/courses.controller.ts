import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CoursesService } from './courses.service';
import { SubmitBlockProgressDto } from './dto/submit-block-progress.dto';
import { AttemptBlockDto } from './dto/attempt-block.dto';

// Limit prób odpowiedzi tekstowych na użytkownika (poza limitem maxAttempts z treści bloku): chroni bazę i utrudnia zgadywanie.
const ATTEMPT_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
// Ładowanie dokumentu embed (iframe ładuje go przy każdym wejściu w blok i po powrocie z podglądu).
const EMBED_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
// Katalog/self-assign celowo NIE dla SUPER_ADMIN (operator platformy, nie pracownik przechodzący szkolenia - D-065).
const COURSE_ROLES = [Role.EMPLOYEE, Role.DEPARTMENT_MANAGER, Role.ORG_ADMIN] as const;

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get('my')
  listMyCourses(@CurrentUser() user: AuthenticatedUser) {
    return this.coursesService.listMyCourses(user.organizationId, user.userId);
  }

  // Kursy globalne bez przypisania temu pracownikowi - do samodzielnego rozpoczęcia (D-065).
  @Get('catalog')
  @Roles(...COURSE_ROLES)
  listCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.coursesService.listCatalog(user.organizationId, user.userId);
  }

  // Samoobsługowe przypisanie kursu z katalogu (ZAWSZE nieobowiązkowe) - 200, nie 201, idempotentne jak start/progress.
  @Post(':courseId/self-assign')
  @HttpCode(HttpStatus.OK)
  @Roles(...COURSE_ROLES)
  selfAssign(@CurrentUser() user: AuthenticatedUser, @Param('courseId') courseId: string) {
    return this.coursesService.selfAssign(user.organizationId, user.userId, courseId);
  }

  // 200, nie domyślne 201 - obie akcje aktualizują istniejący
  // CourseAssignment, nie tworzą nowego zasobu (tak jak login/refresh w
  // auth.controller.ts).
  @Post(':courseId/start')
  @HttpCode(HttpStatus.OK)
  startOrContinue(@CurrentUser() user: AuthenticatedUser, @Param('courseId') courseId: string) {
    return this.coursesService.startOrContinue(user.organizationId, user.userId, courseId);
  }

  @Post(':courseId/progress')
  @HttpCode(HttpStatus.OK)
  submitProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Body() dto: SubmitBlockProgressDto,
  ) {
    return this.coursesService.submitBlockProgress(user.organizationId, user.userId, courseId, dto);
  }

  // Dokument HTML bloku EMBEDDED_HTML ({ html }): tylko dla właściciela przypisania i tylko do bloku bieżącego lub wcześniejszego.
  @Get(':courseId/blocks/:blockId/embed')
  @Throttle(EMBED_THROTTLE)
  @UseGuards(UserThrottlerGuard)
  getEmbeddedHtml(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Param('blockId') blockId: string,
  ) {
    return this.coursesService.getEmbeddedHtml(user.organizationId, user.userId, courseId, blockId);
  }

  // Próba odpowiedzi w bloku TEXT_INPUT_GUIDED: zwraca werdykt i kolejną podpowiedź, nie przesuwa kursu ("Dalej" to /progress).
  @Post(':courseId/blocks/:blockId/attempt')
  @HttpCode(HttpStatus.OK)
  @Throttle(ATTEMPT_THROTTLE)
  @UseGuards(UserThrottlerGuard)
  attemptBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courseId') courseId: string,
    @Param('blockId') blockId: string,
    @Body() dto: AttemptBlockDto,
  ) {
    return this.coursesService.attemptBlock(user.organizationId, user.userId, courseId, blockId, dto.answer);
  }
}
