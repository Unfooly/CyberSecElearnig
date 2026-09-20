import { proxyAuthenticated } from '@/lib/bff';

// Dziennik dostępu do wyników osobowych (tylko ORG_ADMIN).
export async function GET() {
  return proxyAuthenticated('GET', '/phishing/results/settings/audit');
}
