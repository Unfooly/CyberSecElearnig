import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ResellerPortalController, ResellersController } from './resellers.controller';
import { ResellersService } from './resellers.service';

// Panel resellera, krok 1 (D-069): panel operatora (zakładanie partnerów, przypisywanie klientów)
// i lista klientów partnera. UsersModule - zaproszenie pierwszego administratora partnera idzie
// tym samym, przetestowanym mechanizmem co zapraszanie pracownika.
@Module({
  imports: [UsersModule],
  controllers: [ResellersController, ResellerPortalController],
  providers: [ResellersService],
  // OrganizationsService pokazuje klientowi nazwę jego opiekuna (bez historii wejść).
  exports: [ResellersService],
})
export class ResellersModule {}
