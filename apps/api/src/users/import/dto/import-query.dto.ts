import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const IMPORT_ROW_STATUSES = ['VALID', 'EXISTING', 'ERROR'] as const;
export type ImportRowStatusFilter = (typeof IMPORT_ROW_STATUSES)[number];

export class ImportRowsQueryDto {
  @IsOptional()
  @IsIn(IMPORT_ROW_STATUSES)
  status?: ImportRowStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
