import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@cyberszkolo/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ORG_ADMIN, Role.DEPARTMENT_MANAGER)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findAllForOrg(user.organizationId);
  }
}
