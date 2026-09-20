import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/**
 * Nagłówki bezpieczeństwa API (Helmet, konfiguracja domyślna): m.in. `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
 * `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control` oraz
 * usunięcie `X-Powered-By`.
 *
 * BEZ Content-Security-Policy (`contentSecurityPolicy: false`): CSP ustawia aplikacja web (Next.js), która serwuje dokumenty HTML; API
 * zwraca wyłącznie JSON/CSV i jest wołane server-side przez BFF, nie przez przeglądarkę. Wywoływać jako PIERWSZY middleware (przed
 * parsowaniem ciała), żeby nagłówki miały też odpowiedzi błędów parsera i guardów.
 */
export function configureSecurityHeaders(app: INestApplication): void {
  app.use(helmet({ contentSecurityPolicy: false }));
}
