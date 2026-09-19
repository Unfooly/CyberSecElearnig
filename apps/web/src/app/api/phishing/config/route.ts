import { proxyAuthenticated } from '@/lib/bff';

// Status transportu symulacji (bez sekretów). Tylko ORG_ADMIN - egzekwuje apps/api.
export async function GET() {
  return proxyAuthenticated('GET', '/phishing/config');
}
