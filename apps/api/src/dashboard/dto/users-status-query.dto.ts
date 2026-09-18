import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { USERS_STATUS_SORT_FIELDS, type UsersStatusSortField } from '../dashboard-metrics';

export const USERS_STATUS_DEFAULT_PAGE_SIZE = 20;
export const USERS_STATUS_MAX_PAGE_SIZE = 100;

export class UsersStatusQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(USERS_STATUS_MAX_PAGE_SIZE)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  departmentId?: string;

  // Whitelist pól sortowania - wartość od klienta nigdy nie trafia do zapytania.
  @IsOptional()
  @IsIn(USERS_STATUS_SORT_FIELDS)
  sortBy?: UsersStatusSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
