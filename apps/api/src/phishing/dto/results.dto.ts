import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../common/transforms/trim';

export const JUSTIFICATION_MIN_LENGTH = 20;
export const JUSTIFICATION_MAX_LENGTH = 500;

export class SetPersonalResultsDto {
  @IsBoolean()
  enabled!: boolean;

  // Wymagane (min. 20 znaków) przy włączaniu - sprawdza serwis (przy wyłączaniu opcjonalne). Bez znaków sterujących.
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(JUSTIFICATION_MAX_LENGTH)
  @Matches(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u, { message: 'Pole zawiera niedozwolone znaki.' })
  justification?: string;
}

export const PEOPLE_FILTERS = ['ALL', 'PROBLEMS', 'CLICKED', 'SUBMITTED'] as const;
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number];

export class PeopleQueryDto {
  // PROBLEMS = odbiorcy nieudani i "niepewni" (szczegóły kampanii).
  @IsOptional()
  @IsIn(PEOPLE_FILTERS)
  filter?: PeopleFilter;
}
