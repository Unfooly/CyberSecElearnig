import { proxyAuthenticated } from '@/lib/bff';

// Ustawienia wyników osobowych organizacji (tylko ORG_ADMIN - egzekwuje apps/api).
export async function GET() {
  return proxyAuthenticated('GET', '/phishing/results/settings');
}
