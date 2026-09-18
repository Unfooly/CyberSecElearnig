import { UserStatusRowDto } from './user-status-row.dto';

export class UsersStatusResponseDto {
  items!: UserStatusRowDto[];
  total!: number;
  page!: number;
  pageSize!: number;
}
