import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowPendingOrganization } from '../../common/decorators/allow-pending-organization.decorator';
import { SkipSessionCheck } from '../../common/decorators/skip-session-check.decorator';
import { TrackingService } from './tracking.service';

/**
 * Limit żądań na minutę z jednego adresu (osobno dla view i submit). Za wysoki obniżałby ochronę przed zgadywaniem,
 * za niski zaniżałby wyniki: pracownicy jednej firmy często wychodzą przez wspólny adres NAT i otwierają pocztę
 * o tej samej porze. Przy 256-bitowym tokenie zgadywanie jest nierealne, więc limit chroni głównie przed
 * obciążeniem lookupu; twardy limit na brzegu (WAF Cloudflare) jest warunkiem startu (docs/deploy-test.md).
 */
export const TRACKING_RATE_LIMIT = 120;

/**
 * Publiczne endpointy śledzenia symulacji (BEZ JWT): wywołuje je BFF strony lądowania (apps/web), nie przeglądarka
 * wprost. Dlatego:
 * - @AllowPendingOrganization / @SkipSessionCheck: trasa nie zależy od żadnej sesji ani stanu organizacji (i nie dotyczy
 *   organizacji wywołującego - nie ma go); ewentualny Bearer doklejony przez klienta nie może jej blokować,
 * - limit żądań na adres klienta (ProxyAwareThrottlerGuard; BFF przekazuje prawdziwy adres),
 * - kontroler NIE deklaruje @Body: wartości z formularza nie są odczytywane, walidowane, zapisywane ani logowane,
 * - odpowiedź jest zawsze 200 + { lessonHtml } (neutralna dla tokenów poprawnych i niepoprawnych, patrz TrackingService).
 */
@Controller('t')
@AllowPendingOrganization()
@SkipSessionCheck()
export class PhishingTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  // Wejście na stronę lądowania (wywołane przez JS strony po chwili/interakcji - nie przez samo pobranie strony).
  @Post(':token/view')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: TRACKING_RATE_LIMIT, ttl: 60_000 } })
  view(@Param('token') token: string) {
    return this.tracking.view(token);
  }

  // Wysłanie formularza na stronie lądowania. Ciało żądania jest ignorowane.
  @Post(':token/submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: TRACKING_RATE_LIMIT, ttl: 60_000 } })
  submit(@Param('token') token: string) {
    return this.tracking.submit(token);
  }
}
