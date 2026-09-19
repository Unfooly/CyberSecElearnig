import { proxyAuthenticated } from '@/lib/bff';

// "Sprawdź teraz": bez ciała - domenę i token zna wyłącznie apps/api
// (z organizacji w JWT), przeglądarka nie może wskazać innej domeny.
export async function POST() {
  return proxyAuthenticated('POST', '/organization/domain/check');
}
