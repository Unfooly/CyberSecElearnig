import { IsIn, IsOptional } from 'class-validator';
import { LeaderboardScope } from '../gamification.constants';

export class LeaderboardQueryDto {
  // organizationId/userId NIGDY nie przyjmujemy z query - wyłącznie scope,
  // reszta kontekstu (kto pyta, z jakiej organizacji) pochodzi z JWT
  // (@CurrentUser() w kontrolerze). Nawet gdyby klient dosłał tu dodatkowe
  // pola, ValidationPipe (forbidNonWhitelisted: true, main.ts) je odrzuci.
  @IsOptional()
  @IsIn(['organization', 'department'])
  scope?: LeaderboardScope;
}
