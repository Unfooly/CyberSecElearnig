import { IsIn, IsOptional } from 'class-validator';

export class ExportQueryDto {
  // PDF poza zakresem na razie - jedyna obsługiwana wartość to "csv".
  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
