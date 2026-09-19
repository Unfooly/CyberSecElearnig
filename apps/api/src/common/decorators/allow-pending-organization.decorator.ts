import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_ORGANIZATION_KEY = 'allowPendingOrganization';

/**
 * Wyjątek od domyślnej blokady organizacji w stanie PENDING_DOMAIN_VERIFICATION
 * (ActiveOrganizationGuard jest globalny i FAIL-CLOSED: bez tego dekoratora
 * każdy endpoint jest dla takiej organizacji zablokowany). Stosuj tylko dla tras,
 * które organizacja musi mieć zawsze: ekran weryfikacji domeny, ustawienia,
 * dane własnego profilu i uwierzytelnianie. Nigdy dla zasobów biznesowych
 * (pracownicy, kursy, kampanie, raporty).
 */
export const AllowPendingOrganization = () => SetMetadata(ALLOW_PENDING_ORGANIZATION_KEY, true);
