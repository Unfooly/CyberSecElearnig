import { importRoutes } from '@/lib/import-routes';

// Raport CSV importu (walidacja, konto, zaproszenie; komórki escapowane przed formułami po stronie API). Błąd to zawsze JSON,
// nigdy pobieralny plik. Tylko ORG_ADMIN (egzekwuje apps/api).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return importRoutes.report(params.id);
}
