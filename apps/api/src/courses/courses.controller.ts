import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CoursesService } from './courses.service';
import { SubmitBlockProgressDto } from './dto/submit-block-progress.dto';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get('my')
  listMyCourses(@CurrentUser() user: AuthenticatedUser) {
    return this.coursesService.listMyCourses(user.organizationId, user.userId);
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
}
