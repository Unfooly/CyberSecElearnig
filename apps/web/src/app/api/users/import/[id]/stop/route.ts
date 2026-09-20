import { importRoutes } from '@/lib/import-routes';

// Zatrzymanie wysyłki zaproszeń z importu (konta zostają, oczekujące zaproszenia są pomijane). Tylko ORG_ADMIN.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return importRoutes.stop(params.id);
}
