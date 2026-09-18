import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { GamificationService } from './gamification.service';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('badges')
  listBadges(@CurrentUser() user: AuthenticatedUser) {
    return this.gamificationService.listBadgesWithUnlockStatus(user.organizationId, user.userId);
  }

  @Get('leaderboard')
  getLeaderboard(@CurrentUser() user: AuthenticatedUser, @Query() query: LeaderboardQueryDto) {
    return this.gamificationService.getLeaderboard(user.organizationId, user.userId, query.scope ?? 'organization');
  }
}
