import { proxyAuthenticated } from '@/lib/bff';

// Stan organizacji + rekord DNS do weryfikacji (tylko ORG_ADMIN - egzekwuje apps/api).
export async function GET() {
  return proxyAuthenticated('GET', '/organization/me');
}
