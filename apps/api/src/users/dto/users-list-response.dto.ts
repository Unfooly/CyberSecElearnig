import { UserResponseDto } from './user-response.dto';

export class UsersListResponseDto {
  items!: UserResponseDto[];
  total!: number;
  page!: number;
  pageSize!: number;
}
