import { proxyAuthenticated } from '@/lib/bff';

// Lista szablonów (globalne + własne organizacji). Tylko ORG_ADMIN - egzekwuje apps/api.
export async function GET() {
  return proxyAuthenticated('GET', '/phishing/templates');
}
