import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/transforms/trim';

// Limity zgłoszenia (kod sprawdza je jeszcze raz po sanityzacji). Wszystko jest czystym tekstem.
export const SENDER_MAX_LENGTH = 320;
export const SUBJECT_MAX_LENGTH = 300;
export const BODY_MAX_LENGTH = 20_000;
export const HEADERS_MAX_LENGTH = 20_000;
export const COMMENT_MAX_LENGTH = 1000;

export class CreateThreatReportDto {
  // Nadawca tak, jak widać go w programie pocztowym ("Nazwa <adres>" albo sam adres).
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(SENDER_MAX_LENGTH)
  sender!: string;

  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(SUBJECT_MAX_LENGTH)
  subject!: string;

  // Wklejona treść i nagłówki (opcjonalne). Bez Trim: to surowy tekst; sanityzuje go serwis.
  @IsOptional()
  @IsString()
  @MaxLength(BODY_MAX_LENGTH)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(HEADERS_MAX_LENGTH)
  headers?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(COMMENT_MAX_LENGTH)
  comment?: string;
}
