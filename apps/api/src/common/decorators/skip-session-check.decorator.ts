import { SetMetadata } from '@nestjs/common';

export const SKIP_SESSION_CHECK_KEY = 'skipSessionCheck';

/**
 * Pomija w ActiveOrganizationGuard sprawdzenie unieważnienia sesji ("wyloguj wszędzie" / reset hasła)
 * dla trasy/kontrolera. Dotyczy tras PUBLICZNYCH, które nie polegają na access tokenie (login, refresh,
 * logout, reset...): stary, unieważniony Bearer doklejony przez klienta nie ma ich blokować. Poziom
 * metody nadpisuje poziom klasy: @SkipSessionCheck(false) na handlerze przywraca sprawdzenie.
 */
export const SkipSessionCheck = (skip = true) => SetMetadata(SKIP_SESSION_CHECK_KEY, skip);
