import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const REPORT_STATUSES = ['NEW', 'IN_REVIEW', 'THREAT', 'SAFE'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTE_MAX_LENGTH = 1000;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export class InboxQueryDto {
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: ReportStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export class ChangeStatusDto {
  @IsIn(REPORT_STATUSES)
  status!: ReportStatus;
}

export class AddNoteDto {
  // Treść notatki (czysty tekst); serwis sanityzuje ją i maskuje linki śledzące, a puste po sanityzacji odrzuca (400).
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note!: string;
}
